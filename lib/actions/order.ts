"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getStripe, calcFeeCents } from "@/lib/stripe";
import { sendEmail, orderReceivedEmail } from "@/lib/email";

export type OrderState = { error?: string };

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function placeOrderAction(
  _prev: OrderState,
  formData: FormData
): Promise<OrderState> {
  const dropId = String(formData.get("dropId") ?? "");
  const buyerName = String(formData.get("buyerName") ?? "").trim();
  const buyerEmail = String(formData.get("buyerEmail") ?? "").trim().toLowerCase();
  const buyerPhone = String(formData.get("buyerPhone") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!buyerName) return { error: "Please add your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail))
    return { error: "Please add a valid email for your receipt." };

  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: { products: true, seller: true },
  });
  if (!drop) return { error: "This drop no longer exists." };
  if (drop.status !== "live") return { error: "Ordering for this drop is closed." };

  // Build line items from server-trusted prices + inventory
  const lines: { product: (typeof drop.products)[number]; qty: number }[] = [];
  for (const p of drop.products) {
    const qty = Math.max(0, parseInt(String(formData.get(`qty_${p.id}`) ?? "0"), 10) || 0);
    if (qty <= 0) continue;
    const remaining = p.inventory - p.sold;
    if (qty > remaining) {
      return { error: `Only ${remaining} left of ${p.name}. Adjust your cart.` };
    }
    lines.push({ product: p, qty });
  }
  if (lines.length === 0) return { error: "Add at least one item to your order." };

  const totalCents = lines.reduce((s, l) => s + l.product.priceCents * l.qty, 0);
  const feeCents = calcFeeCents(totalCents);

  const stripe = getStripe();
  const useStripe =
    !!stripe && drop.seller.stripeChargesEnabled && !!drop.seller.stripeAccountId;

  // ----- Real payments via Stripe Connect (destination charge + platform fee) -----
  if (useStripe && stripe) {
    const order = await prisma.order.create({
      data: {
        dropId: drop.id,
        sellerId: drop.sellerId,
        buyerName,
        buyerEmail,
        buyerPhone,
        note,
        totalCents,
        feeCents,
        status: "pending",
        items: {
          create: lines.map((l) => ({
            productId: l.product.id,
            name: l.product.name,
            priceCents: l.product.priceCents,
            quantity: l.qty,
          })),
        },
      },
    });

    const base = await baseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: buyerEmail,
      line_items: lines.map((l) => ({
        quantity: l.qty,
        price_data: {
          currency: "usd",
          unit_amount: l.product.priceCents,
          product_data: {
            name: l.product.name,
            ...(l.product.description ? { description: l.product.description } : {}),
          },
        },
      })),
      payment_intent_data: {
        // DropQ's clean platform cut. The vendor (merchant of record on this
        // direct charge) covers Stripe's processing fee.
        application_fee_amount: feeCents,
        metadata: { orderId: order.id },
      },
      metadata: { orderId: order.id },
      success_url: `${base}/order/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/s/${drop.seller.slug}/${drop.id}?canceled=1`,
    },
    // Direct charge: create the Checkout Session on the vendor's connected account.
    { stripeAccount: drop.seller.stripeAccountId! });

    await prisma.order.update({
      where: { id: order.id },
      data: { stripeSessionId: session.id },
    });

    redirect(session.url!);
  }

  // ----- Demo mode (no Stripe configured): finalize immediately -----
  const order = await prisma
    .$transaction(async (tx) => {
      for (const l of lines) {
        const fresh = await tx.product.findUnique({ where: { id: l.product.id } });
        if (!fresh || fresh.sold + l.qty > fresh.inventory) {
          throw new Error(`SOLD_OUT:${l.product.name}`);
        }
      }
      for (const l of lines) {
        await tx.product.update({
          where: { id: l.product.id },
          data: { sold: { increment: l.qty } },
        });
      }
      return tx.order.create({
        data: {
          dropId: drop.id,
          sellerId: drop.sellerId,
          buyerName,
          buyerEmail,
          buyerPhone,
          note,
          totalCents,
          feeCents,
          status: "new",
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              name: l.product.name,
              priceCents: l.product.priceCents,
              quantity: l.qty,
            })),
          },
        },
      });
    })
    .catch((e: unknown) => {
      if (e instanceof Error && e.message.startsWith("SOLD_OUT:")) return null;
      throw e;
    });

  if (!order) {
    return { error: "Sorry — an item just sold out. Refresh and try again." };
  }

  // Confirmation email to the buyer, delivered in the background (no-op in dev
  // without RESEND_API_KEY).
  const mail = orderReceivedEmail({
    to: buyerEmail,
    storeName: drop.seller.storeName,
    buyerFirst: buyerName.split(" ")[0] || buyerName,
    orderLink: `${await baseUrl()}/order/${order.id}`,
    pickupInfo: drop.pickupInfo,
    fulfillment: drop.fulfillment,
  });
  after(() => sendEmail(mail));

  revalidatePath(`/s/${drop.seller.slug}/${drop.id}`);
  revalidatePath(`/dashboard/drops/${drop.id}`);
  redirect(`/order/${order.id}`);
}
