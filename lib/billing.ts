import "server-only";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

/** Flip a seller onto the Growth plan and record their Stripe billing handles. */
export async function activateGrowth(
  sellerId: string,
  data: { subscriptionId?: string; customerId?: string; status?: string }
) {
  await prisma.seller.updateMany({
    where: { id: sellerId },
    data: {
      plan: "growth",
      subscriptionStatus: data.status ?? "active",
      ...(data.subscriptionId ? { stripeSubscriptionId: data.subscriptionId } : {}),
      ...(data.customerId ? { stripeCustomerId: data.customerId } : {}),
    },
  });
}

/**
 * Persist the Partner → Growth conversion for any expired Partner accounts.
 * Read-time gating already treats expired Partners as Growth (see effectivePlan);
 * this writes it through so the stored plan stays accurate. Runs from the cron.
 */
export async function convertExpiredPartners(): Promise<number> {
  const res = await prisma.seller.updateMany({
    where: { plan: "partner", partnerExpiresAt: { lt: new Date() } },
    data: { plan: "growth" },
  });
  return res.count;
}

/**
 * Webhook-independent finalize: called on the billing success page so an upgrade
 * activates even if the subscription webhook hasn't landed yet. Idempotent.
 */
export async function finalizeGrowthCheckout(sessionId: string): Promise<void> {
  const stripe = getStripe();
  if (!stripe) return;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== "subscription") return;
    const paid = session.payment_status === "paid" || session.status === "complete";
    const sellerId = session.metadata?.sellerId;
    if (!paid || !sellerId) return;
    await activateGrowth(sellerId, {
      subscriptionId:
        typeof session.subscription === "string" ? session.subscription : undefined,
      customerId: typeof session.customer === "string" ? session.customer : undefined,
      status: "active",
    });
  } catch (e) {
    console.error("finalizeGrowthCheckout failed:", e);
  }
}
