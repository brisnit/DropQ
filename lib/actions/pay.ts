"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getStripe, calcFeeCents } from "@/lib/stripe";
import { upsertCustomer } from "@/lib/customer-auth";
import { applyFirstTouch } from "@/lib/attribution";
import {
  MINIMUM_TOTAL_ERROR,
  UNSELLABLE_ITEM_ERROR,
  belowStripeMinimum,
  hasBelowMinimumUnitPrice,
  buildCheckoutSessionParams,
  checkoutSessionTotalCents,
  defaultExpiresAt,
} from "@/lib/checkout-session";
import { closeUnpayableOrder, stripeSetupError } from "@/lib/checkout";
import {
  isWalkUpEnabled,
  walkUpMode,
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
  // Checked server-side on the public path too. In "internal" mode eligibility
  // depends on the sale's seller, re-checked once the sale is loaded below.
  if (walkUpMode() === "off") return { error: "This payment link isn't available." };

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

  // Only the seller is needed. An earlier `drop: { select: { id, slug } }` was
  // dead — every use below reads `existing.dropId` — and `Drop` has no `slug`,
  // so Prisma rejected the whole query at runtime. An `as never` cast hid that
  // from the compiler, and no test executed this function against a database,
  // so the action could never take a payment. Include only what is used.
  const existing = await prisma.walkUpSale.findUnique({
    where: { token },
    include: { seller: true },
  });
  if (!existing) return { error: "This payment link isn't valid." };
  if (!isWalkUpEnabled(existing.seller))
    return { error: "This payment link isn't available." };
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

  // Same unit-price rule as online checkout. A walk-up sale is still a DropQ
  // sale, and a vendor ringing up a legacy 20c item at the market must hit the
  // same wall the storefront does.
  if (hasBelowMinimumUnitPrice(lines)) {
    return { error: UNSELLABLE_ITEM_ERROR };
  }

  const itemsCents = walkUpTotalCents(lines);
  const feeCents = calcFeeCents(itemsCents, existing.seller);
  const passFee = existing.seller.feeMode === "pass";
  const totalCents = passFee ? itemsCents + feeCents : itemsCents;

  // ----- Stripe's $0.50 floor, checked BEFORE anything is written -----------
  //
  // Same guard as online checkout, and it matters more here: below this line
  // the transaction both creates an Order and CLAIMS the WalkUpSale, so a
  // Stripe refusal after that point would strand the vendor's sale as well as
  // the order. Nothing is created above this line.
  const stripeTotalCents = checkoutSessionTotalCents({
    lines: lines.map((l) => ({ priceCents: l.priceCents, quantity: l.quantity, name: l.name })),
    feeCents,
    passFee,
  });
  if (belowStripeMinimum(stripeTotalCents)) {
    return { error: MINIMUM_TOTAL_ERROR };
  }

  // Durable identity, exactly as online checkout does it. Email-keyed, no
  // password, no account required before paying.
  const customer = await upsertCustomer({ email, name: firstName, phone }).catch((e) => {
    console.error("upsertCustomer at walk-up pay failed:", e);
    return null;
  });
  const customerId = customer?.id ?? null;

  // Acquisition: this customer entered DropQ standing in front of the vendor.
  // Distinct from "qr", which means they scanned a share link and self-ordered.
  //
  // `authoritative` because a physical, vendor-initiated sale beats whatever
  // `dq_touch` happens to be on the phone. The first real canary was credited
  // to a different vendor's storefront from a two-day-old cookie.
  if (customerId) {
    await applyFirstTouch(
      customerId,
      {
        vendorId: existing.sellerId,
        dropId: existing.dropId,
        source: "in_person",
        detail: existing.seller.slug,
      },
      { authoritative: true }
    ).catch(() => {});
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

  let session;
  try {
    session = await stripe.checkout.sessions.create(params, {
      stripeAccount: existing.seller.stripeAccountId,
    });
  } catch (e) {
    await closeUnpayableOrder(orderId, e, "walkup");
    // Release the claim so the vendor can retry this sale. Guarded on THIS
    // order id, so it can never release a claim someone else won: without it a
    // Stripe refusal would brick the walk-up sale permanently, since the claim
    // is what stops a second attempt.
    await prisma.walkUpSale
      .updateMany({ where: { id: existing.id, orderId }, data: { orderId: null } })
      .catch(() => {});
    return { error: stripeSetupError(e) };
  }
  await prisma.order.update({
    where: { id: orderId },
    data: { stripeSessionId: session.id },
  });

  redirect(session.url!);
}
