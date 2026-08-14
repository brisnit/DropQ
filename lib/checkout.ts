import "server-only";
import { prisma } from "@/lib/db";
import { awardPointsForOrder, reversePointsForOrder } from "@/lib/rewards";
import { getStripe } from "@/lib/stripe";
import { sendEmail, orderReceivedEmail } from "@/lib/email";
import { sendSms } from "@/lib/notifications";
import { sendGatedSms } from "@/lib/sms-gate";
import { createCommissionForOrder } from "@/lib/commission";
import { formatPickupWindow, pickupLocation } from "@/lib/pickup";

// Header-free base URL — finalizePaidOrder runs from webhooks and cron sweeps
// that have no request context, so we can't rely on headers().
function orderBaseUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
}

/**
 * Mark a pending order as paid and increment inventory — exactly once.
 * Safe to call from both the Stripe webhook and the success page (idempotent).
 *
 * Oversell protection: inventory is incremented with an atomic conditional
 * UPDATE (sold + qty <= inventory). If any item can't be fulfilled (someone
 * else paid for the last unit first), the whole order is auto-canceled and the
 * customer is refunded — inventory never goes negative.
 */
export async function finalizePaidOrder(
  orderId: string,
  paymentIntentId?: string | null
) {
  const result = await prisma.$transaction(async (tx) => {
    // Atomically claim the order: only the first caller flips it out of "pending".
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: {
        status: "new",
        paymentStatus: "paid",
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      },
    });

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        seller: { select: { storeName: true, logoUrl: true, accent: true, timezone: true } },
        drop: {
          select: {
            pickupInfo: true, fulfillment: true,
            pickupStartAt: true, pickupEndAt: true,
            pickupLocationName: true, pickupAddress: true, pickupNotes: true,
          },
        },
      },
    });
    if (!order) return { state: "missing" as const, order: null };

    // Already finalized by someone else — nothing more to do.
    if (claimed.count === 0) return { state: "done" as const, order };

    await tx.orderEvent.create({ data: { orderId, type: "payment", detail: "paid" } });

    // Conditionally claim stock for each item; track what we applied so we can
    // roll back if any item is oversold.
    const applied: { id: string; qty: number }[] = [];
    let oversold = false;
    for (const it of order.items) {
      if (!it.productId) continue; // product removed from the drop since order
      const n = await tx.$executeRaw`
        UPDATE "Product" SET sold = sold + ${it.quantity}
        WHERE id = ${it.productId} AND sold + ${it.quantity} <= inventory`;
      if (n > 0) applied.push({ id: it.productId, qty: it.quantity });
      else oversold = true;
    }

    if (oversold) {
      // Give back any units we tentatively claimed and cancel the order.
      for (const a of applied) {
        await tx.$executeRaw`UPDATE "Product" SET sold = sold - ${a.qty} WHERE id = ${a.id}`;
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: "canceled", paymentStatus: "refund_pending" },
      });
      await tx.orderEvent.create({ data: { orderId, type: "oversold", detail: "auto-canceled" } });
      return { state: "oversold" as const, order };
    }

    return { state: "ok" as const, order };
  });

  // Refund oversold orders outside the transaction (needs Stripe + the
  // connected account). Idempotent via the refund_pending guard.
  if (result.state === "oversold" && result.order) {
    await refundOversoldOrder(orderId);
  }

  // DropPoints — $1 spent = 1 point. Awarded outside the transaction and
  // idempotent via the unique (orderId, reason), so a webhook retry can't
  // double-award.
  if (result.state === "ok" && result.order) {
    await awardPointsForOrder(orderId).catch((e) =>
      console.error("awardPointsForOrder failed:", e)
    );
  }

  // Sales-rep commission — created exactly once (the atomic paid-claim above
  // guarantees this block runs once per order; the unique (orderId, salesRepId)
  // is a second guard). Only for orders whose vendor is tied to a sales rep.
  if (result.state === "ok" && result.order) {
    await createCommissionForOrder(result.order);
  }

  // Confirmation email — only on the call that actually flipped the order to
  // paid (state "ok"), so the webhook/success-page race emails exactly once.
  if (result.state === "ok" && result.order) {
    const o = result.order;
    const first = o.buyerName.split(" ")[0] || o.buyerName;
    try {
      await sendEmail(
        orderReceivedEmail({
          to: o.buyerEmail,
          storeName: o.seller.storeName,
          buyerFirst: first,
          orderLink: `${orderBaseUrl()}/order/${o.id}`,
          pickupInfo: o.drop.pickupInfo,
          fulfillment: o.drop.fulfillment,
          pickupWindow: formatPickupWindow(o.drop, o.seller.timezone),
          pickupWhere: pickupLocation(o.drop),
          logoUrl: o.seller.logoUrl,
          accent: o.seller.accent,
        })
      );
    } catch (e) {
      console.error("Order confirmation email failed:", e);
    }
  }

  return result.order;
}

/** Refund + notify a buyer whose order was auto-canceled for being oversold. */
async function refundOversoldOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { seller: { select: { storeName: true, stripeAccountId: true } } },
  });
  if (!order || order.paymentStatus !== "refund_pending") return;

  const stripe = getStripe();
  if (stripe && order.stripePaymentIntentId && order.seller.stripeAccountId) {
    try {
      // refund_application_fee returns DropQ's platform fee to the vendor.
      // Without it the buyer is made whole from the vendor's balance while
      // DropQ keeps its cut — the vendor ends up out of pocket on a sale that
      // never happened, plus Stripe's processing fee.
      await stripe.refunds.create(
        { payment_intent: order.stripePaymentIntentId, refund_application_fee: true },
        { stripeAccount: order.seller.stripeAccountId, idempotencyKey: `oversold-refund-${order.id}` }
      );
    } catch (e) {
      console.error("Oversold refund failed:", e);
      return; // leave as refund_pending; a later sweep/manual action can retry
    }
  }
  await prisma.order.update({
    where: { id: orderId },
    data: { paymentStatus: "refunded" },
  });
  // Points follow the money — a refunded order shouldn't leave points behind.
  await reversePointsForOrder(orderId, "oversold refund");

  const first = order.buyerName.split(" ")[0] || order.buyerName;
  const store = order.seller.storeName;
  const msg = `${store}: So sorry — an item in your order just sold out, so we've refunded you in full. Hope to see you at the next drop!`;
  try {
    await sendGatedSms({ kind: "transactional", body: msg, customerId: order.customerId, email: order.buyerEmail, to: order.buyerPhone });
    await sendEmail({
      to: order.buyerEmail,
      subject: `Your ${store} order was refunded`,
      html: `<div style="font-family:sans-serif;color:#1a1a1a"><p>Hi ${first},</p><p>${msg}</p></div>`,
    });
  } catch (e) {
    console.error("Oversold notify failed:", e);
  }
}

/**
 * Backstop for orders that paid but never finalized (buyer bounced before the
 * success-page redirect, and the webhook didn't land). Checks Stripe truth for
 * each stale pending order and finalizes paid ones / cancels expired ones.
 * Returns counts. Safe to run repeatedly (idempotent via finalizePaidOrder).
 */
export async function reconcilePendingOrders(maxAgeMinutes = 15): Promise<{
  finalized: number;
  expired: number;
  checked: number;
}> {
  const stripe = getStripe();
  if (!stripe) return { finalized: 0, expired: 0, checked: 0 };

  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  const stale = await prisma.order.findMany({
    where: { status: "pending", stripeSessionId: { not: null }, createdAt: { lt: cutoff } },
    select: {
      id: true,
      stripeSessionId: true,
      seller: { select: { stripeAccountId: true } },
    },
    take: 200,
  });

  let finalized = 0;
  let expired = 0;
  for (const o of stale) {
    if (!o.stripeSessionId || !o.seller.stripeAccountId) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(
        o.stripeSessionId,
        {},
        { stripeAccount: o.seller.stripeAccountId }
      );
      if (session.payment_status === "paid") {
        const pi = typeof session.payment_intent === "string" ? session.payment_intent : null;
        await finalizePaidOrder(o.id, pi);
        finalized++;
      } else if (session.status === "expired") {
        await prisma.order.updateMany({
          where: { id: o.id, status: "pending" },
          data: { status: "canceled", paymentStatus: "expired" },
        });
        expired++;
      }
    } catch (e) {
      console.error("Reconcile order failed:", o.id, e);
    }
  }
  return { finalized, expired, checked: stale.length };
}
