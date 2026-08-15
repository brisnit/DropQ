"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getStripe, calcFeeCents } from "@/lib/stripe";
import { upsertCustomer } from "@/lib/customer-auth";
import { applyFirstTouch } from "@/lib/attribution";
import { buildCheckoutSessionParams, defaultExpiresAt } from "@/lib/checkout-session";
import {
  isWalkUpEnabled,
  linesFromJson,
  snapshotToOrderItems,
  walkUpSaleState,
  walkUpTotalCents,
} from "@/lib/walkup";

/**
 * Convert a walk-up sale into a real Order and hand it to the existing Stripe
 * pipeline (Phase E).
 *
 * This is the ONLY place a WalkUpSale becomes an Order. After it runs, the
 * order is an ordinary `pending` order and everything downstream —
 * finalizePaidOrder, inventory, DropPoints, commission, the relationship, the
 * receipt — is the existing online pipeline, unchanged.
 *
 * Public route: authorised purely by possession of the unguessable token, and
 * scoped to paying that one quoted sale. It grants no account access and can
 * mutate nothing else.
 */

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export type PayState = { error?: string };

export async function payWalkUpSaleAction(
  _prev: PayState,
  formData: FormData
): Promise<PayState> {
  // The flag is a real kill switch, checked server-side on the public path too.
  if (!isWalkUpEnabled()) return { error: "This payment link isn't available." };

  const token = String(formData.get("token") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim() || null;

  if (!token) return { error: "This payment link isn't valid." };
  if (!firstName) return { error: "Please add your first name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: "Please add a valid email for your receipt." };
  if (phone && phone.replace(/\D/g, "").length < 10)
    return { error: "That mobile number doesn't look right." };

  const existing = await prisma.walkUpSale.findUnique({
    where: { token },
    include: { seller: true, drop: { select: { id: true, slug: true } } as never },
  });
  if (!existing) return { error: "This payment link isn't valid." };
  if (walkUpSaleState(existing) !== "open")
    return { error: "This sale is no longer active. Ask the vendor to start a new one." };

  const stripe = getStripe();
  if (!stripe || !existing.seller.stripeChargesEnabled || !existing.seller.stripeAccountId) {
    return { error: "This store can't take card payments right now." };
  }

  const lines = linesFromJson(existing.lines);
  if (lines.length === 0) return { error: "This sale has no items." };

  // The quoted snapshot is the bill. Product identity is re-checked (a deleted
  // product can't be sold) but its CURRENT price is deliberately ignored.
  const products = await prisma.product.findMany({
    where: { id: { in: lines.map((l) => l.productId) }, dropId: existing.dropId },
    select: { id: true },
  });
  const known = new Set(products.map((p) => p.id));
  if (lines.some((l) => !known.has(l.productId))) {
    return { error: "Something in this sale is no longer available. Ask the vendor to redo it." };
  }

  const itemsCents = walkUpTotalCents(lines);
  const feeCents = calcFeeCents(itemsCents);
  const passFee = existing.seller.feeMode === "pass";
  const totalCents = passFee ? itemsCents + feeCents : itemsCents;

  // Durable identity, exactly as online checkout does it. Email-keyed, no
  // password, no account required before paying.
  const customer = await upsertCustomer({ email, name: firstName, phone }).catch((e) => {
    console.error("upsertCustomer at walk-up pay failed:", e);
    return null;
  });
  const customerId = customer?.id ?? null;

  // Acquisition: this customer entered DropQ standing in front of the vendor.
  // Distinct from "qr", which means they scanned a share link and self-ordered.
  if (customerId) {
    await applyFirstTouch(customerId, {
      vendorId: existing.sellerId,
      dropId: existing.dropId,
      source: "in_person",
      detail: existing.seller.slug,
    }).catch(() => {});
  }

  // ---- The conversion. One transaction so a losing racer leaves no orphan. --
  let orderId: string;
  try {
    orderId = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          dropId: existing.dropId,
          sellerId: existing.sellerId,
          buyerName: firstName,
          buyerEmail: email,
          buyerPhone: phone,
          customerId,
          totalCents,
          feeCents,
          status: "pending",
          paymentStatus: "pending",
          source: "in_person",
          events: { create: { type: "created", detail: "in_person" } },
          items: { create: snapshotToOrderItems(lines) },
        },
        select: { id: true },
      });

      // Atomic claim. Only the first scanner wins; the loser throws, which
      // rolls this transaction back and removes the Order it just created.
      const claimed = await tx.walkUpSale.updateMany({
        where: { id: existing.id, orderId: null, canceledAt: null },
        data: { orderId: order.id },
      });
      if (claimed.count === 0) throw new Error("ALREADY_CONVERTED");
      return order.id;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_CONVERTED") {
      // Someone else already started paying this exact sale.
      redirect(`/pay/${token}`);
    }
    throw e;
  }

  // ---- Straight into the existing Stripe pipeline (C2's shared builder) ----
  const base = await baseUrl();
  const params = buildCheckoutSessionParams({
    orderId,
    buyerEmail: email,
    lines: lines.map((l) => ({
      priceCents: l.priceCents,
      quantity: l.quantity,
      name: l.name,
    })),
    feeCents,
    passFee,
    successUrl: `${base}/order/${orderId}?session_id={CHECKOUT_SESSION_ID}`,
    // Back to the pay page, not a storefront this customer never visited.
    cancelUrl: `${base}/pay/${token}?canceled=1`,
    expiresAt: defaultExpiresAt(),
  });

  const session = await stripe.checkout.sessions.create(params, {
    stripeAccount: existing.seller.stripeAccountId,
  });
  await prisma.order.update({
    where: { id: orderId },
    data: { stripeSessionId: session.id },
  });

  redirect(session.url!);
}
