import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { finalizePaidOrder } from "@/lib/checkout";
import { activateGrowth } from "@/lib/billing";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return new Response("Stripe not configured", { status: 400 });
  }

  const sig = req.headers.get("stripe-signature");
  const body = await req.text(); // raw body required for signature verification

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

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
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      await prisma.seller.updateMany({
        where: { stripeAccountId: account.id },
        data: { stripeChargesEnabled: !!account.charges_enabled },
      });
      break;
    }
  }

  return new Response("ok", { status: 200 });
}
