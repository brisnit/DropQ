import "server-only";
import { prisma } from "@/lib/db";
import { getStripe, ensureGrowthPriceId } from "@/lib/stripe";
import { grantReferralRewardForConversion } from "@/lib/referral";

/**
 * Create a Stripe Checkout subscription URL for the Growth plan for a given
 * seller (creating/reusing their Stripe customer). Returns null if Stripe isn't
 * configured. Shared by the dashboard upgrade and the Growth signup flow.
 */
export async function createGrowthCheckoutUrl(
  seller: { id: string; email: string; storeName: string; stripeCustomerId: string | null },
  opts: { successUrl: string; cancelUrl: string }
): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  let customerId = seller.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: seller.email,
      name: seller.storeName,
      metadata: { sellerId: seller.id },
    });
    customerId = customer.id;
    await prisma.seller.update({
      where: { id: seller.id },
      data: { stripeCustomerId: customerId },
    });
  }

  const priceId = await ensureGrowthPriceId(stripe);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { sellerId: seller.id, plan: "growth" },
    subscription_data: { metadata: { sellerId: seller.id } },
    allow_promotion_codes: true,
  });
  return session.url;
}

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
  // A referred vendor converting to paid Growth is what unlocks the referrer's reward.
  await grantReferralRewardForConversion(sellerId);
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
