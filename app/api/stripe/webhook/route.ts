import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { finalizePaidOrder } from "@/lib/checkout";
import { activateGrowth } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { notifyAdminsOfDispute } from "@/lib/disputes";
import { notifyVendorSellingPaused } from "@/lib/vendor-alerts";

/**
 * This one URL receives events from TWO Stripe destinations, and each signs
 * with its own secret:
 *
 *   account  — DropQ's own platform events (customer.subscription.*)
 *   connect  — events raised on connected accounts. Because we take direct
 *              charges, `checkout.session.completed` arrives here, as do
 *              `charge.dispute.*` and `account.updated`.
 *
 * Verifying against a single secret meant the other destination returned 400
 * forever. In production that was the Connect destination at a 100% failure
 * rate, silently — the customer's `/order/[id]` redirect was finalizing orders,
 * so nothing looked broken until a walk-up sale needed the webhook as its
 * fallback. Try each configured secret; the first that verifies wins.
 */
function webhookSecrets(): { label: string; secret: string }[] {
  return [
    { label: "account", secret: process.env.STRIPE_WEBHOOK_SECRET ?? "" },
    { label: "connect", secret: process.env.STRIPE_WEBHOOK_SECRET_CONNECT ?? "" },
  ].filter((s) => s.secret.length > 0);
}

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secrets = webhookSecrets();
  if (!stripe || secrets.length === 0) {
    return new Response("Stripe not configured", { status: 400 });
  }

  const sig = req.headers.get("stripe-signature");
  const body = await req.text(); // raw body required for signature verification

  let event: Stripe.Event | null = null;
  let verifiedBy = "";
  for (const { label, secret } of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, sig ?? "", secret);
      verifiedBy = label;
      break;
    } catch {
      // Wrong destination for this secret — try the next one.
    }
  }
  if (!event) {
    // Names the secrets that were TRIED — never their values. Stripe shows the
    // response body on each delivery attempt, and platform logs don't surface
    // console output, so this is the only way to tell "the connect secret isn't
    // loaded" apart from "it's loaded but wrong" without guessing.
    const tried = secrets.map((s) => s.label).join(", ");
    console.error(`[stripe] signature verification failed; tried: ${tried}`);
    return new Response(`Invalid signature (tried: ${tried})`, { status: 400 });
  }
  // Label only — never the secret itself. Makes it visible in the logs which
  // destination an event came from.
  console.log(`[stripe] ${event.type} verified via ${verifiedBy} secret`);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;
      if (orderId && session.payment_status === "paid") {
        // Customer order (direct charge on a connected account).
        const pi =
          typeof session.payment_intent === "string" ? session.payment_intent : null;
        await finalizePaidOrder(orderId, pi);
      } else if (session.mode === "subscription" && session.metadata?.sellerId) {
        // DropQ Growth subscription purchase.
        await activateGrowth(session.metadata.sellerId, {
          subscriptionId:
            typeof session.subscription === "string" ? session.subscription : undefined,
          customerId:
            typeof session.customer === "string" ? session.customer : undefined,
          status: "active",
        });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const sellerId = sub.metadata?.sellerId;
      if (sellerId) {
        const active = ["active", "trialing", "past_due"].includes(sub.status);
        await prisma.seller.updateMany({
          where: { id: sellerId },
          data: {
            subscriptionStatus: sub.status,
            stripeSubscriptionId: sub.id,
            ...(active ? { plan: "growth" } : {}),
          },
        });
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const sellerId = sub.metadata?.sellerId;
      if (sellerId) {
        // Subscription ended — revert to the free Starter plan.
        await prisma.seller.updateMany({
          where: { id: sellerId },
          data: { subscriptionStatus: "canceled", plan: "starter", stripeSubscriptionId: null },
        });
      }
      break;
    }
    // Disputes land on the VENDOR's account under direct charges, so DropQ is
    // not financially liable — but it has had no visibility at all, which means
    // no support follow-up and no fraud signal. These arrive as Connect events
    // with `event.account` set to the connected account.
    //
    // (If Payments v2 ever ships, disputes move to the platform balance and
    // this handler becomes financially load-bearing. See
    // docs/PAYMENTS-V2-ARCHITECTURE.md.)
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      const connectedAccountId = event.account ?? null;

      const seller = connectedAccountId
        ? await prisma.seller.findFirst({
            where: { stripeAccountId: connectedAccountId },
            select: { id: true, storeName: true, email: true },
          })
        : null;

      // Best-effort link back to the order via the payment intent.
      const paymentIntentId =
        typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : (dispute.payment_intent?.id ?? null);
      const order = paymentIntentId
        ? await prisma.order.findFirst({
            where: { stripePaymentIntentId: paymentIntentId },
            select: { id: true, buyerName: true, buyerEmail: true, totalCents: true },
          })
        : null;

      console.error(
        `[stripe] ${event.type} — vendor=${seller?.storeName ?? connectedAccountId ?? "unknown"} ` +
          `order=${order?.id ?? "unmatched"} amount=${dispute.amount} reason=${dispute.reason} ` +
          `status=${dispute.status} dispute=${dispute.id}`
      );

      if (event.type === "charge.dispute.created") {
        await notifyAdminsOfDispute({
          disputeId: dispute.id,
          reason: dispute.reason,
          amountCents: dispute.amount,
          storeName: seller?.storeName ?? null,
          vendorEmail: seller?.email ?? null,
          orderId: order?.id ?? null,
          buyerName: order?.buyerName ?? null,
        });
      }
      break;
    }
    // Keeps Seller.stripeChargesEnabled in step with Stripe, and tells the
    // vendor when that flag going false has just stopped them selling.
    //
    // Stripe emits account.updated constantly (onboarding steps, document
    // uploads, periodic re-verification) and retries webhooks, so the email
    // must fire on the TRANSITION, not on the event. The conditional
    // updateMany below is the transition detector: only the call that actually
    // flips the flag matches a row, exactly as finalizePaidOrder claims an
    // order. Everything else updates nothing and stays silent.
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const chargesEnabled = !!account.charges_enabled;

      const flipped = await prisma.seller.updateMany({
        where: { stripeAccountId: account.id, stripeChargesEnabled: !chargesEnabled },
        data: { stripeChargesEnabled: chargesEnabled },
      });

      // Activation history (Phase V.1). Deliberately a SECOND, separately
      // predicated update rather than a field on the one above: folding it in
      // would re-stamp the column on every later re-activation. Predicating on
      // `stripeChargesEnabledAt: null` means the row matches only while unset,
      // so the FIRST activation wins and every later one updates zero rows.
      //
      // stripeChargesEnabled stays authoritative for CURRENT sellability; this
      // column is history only, and is never cleared on true -> false. That is
      // what lets lib/activation.ts tell "was selling, now restricted" from
      // "never finished onboarding".
      if (flipped.count > 0 && chargesEnabled) {
        await prisma.seller.updateMany({
          where: { stripeAccountId: account.id, stripeChargesEnabledAt: null },
          data: { stripeChargesEnabledAt: new Date() },
        });
      }

      // Only on charge-ready -> not charge-ready. Becoming ready again needs no
      // alert: the vendor's storefront simply starts working and the dashboard
      // banner disappears.
      if (flipped.count > 0 && !chargesEnabled) {
        await notifyVendorSellingPaused(account.id);
      }
      break;
    }
  }

  return new Response("ok", { status: 200 });
}
