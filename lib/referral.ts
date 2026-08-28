import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { GROWTH_PRICE_CENTS } from "@/lib/plans";

export const REFERRAL_BONUS_MONTHS = 1;

function randomCode(): string {
  return randomBytes(8)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 7)
    .toUpperCase();
}

/** A vendor's referral code, created lazily on first view. */
export async function getOrCreateReferralCode(seller: {
  id: string;
  referralCode: string | null;
}): Promise<string> {
  if (seller.referralCode) return seller.referralCode;
  for (let i = 0; i < 6; i++) {
    const code = randomCode();
    try {
      await prisma.seller.update({ where: { id: seller.id }, data: { referralCode: code } });
      return code;
    } catch {
      // unique collision — try another code
    }
  }
  const fallback = seller.id.slice(-7).toUpperCase();
  await prisma.seller
    .update({ where: { id: seller.id }, data: { referralCode: fallback } })
    .catch(() => {});
  return fallback;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/**
 * Reward the referrer with 1 free month of the paid plan. Paying (Stripe) vendors
 * get a billing credit; everyone else gets bonus paid-level access in the database.
 * `referralId` keys the Stripe credit so it can never be applied twice.
 */
async function grantReferralReward(referrerId: string, referralId: string): Promise<void> {
  const referrer = await prisma.seller.findUnique({ where: { id: referrerId } });
  if (!referrer) return;

  let creditApplied = false;
  if (referrer.stripeCustomerId && referrer.subscriptionStatus === "active") {
    const stripe = getStripe();
    if (stripe) {
      try {
        await stripe.customers.createBalanceTransaction(
          referrer.stripeCustomerId,
          {
            amount: -GROWTH_PRICE_CENTS, // negative = credit toward future invoices
            currency: "usd",
            description: "DropQ referral reward — 1 month of Basic",
          },
          { idempotencyKey: `referral-credit-${referralId}` }
        );
        creditApplied = true;
      } catch (e) {
        console.error("Referral Stripe credit failed:", e);
      }
    }
  }

  if (!creditApplied) {
    const now = new Date();
    const base =
      referrer.growthBonusUntil && referrer.growthBonusUntil > now
        ? referrer.growthBonusUntil
        : now;
    await prisma.seller.update({
      where: { id: referrerId },
      data: { growthBonusUntil: addMonths(base, REFERRAL_BONUS_MONTHS) },
    });
  }
}

/**
 * Record (only) that a newly-signed-up vendor used refCode. The reward is NOT
 * granted here — it's gated on the referred vendor converting to paid Growth
 * (see grantReferralRewardForConversion) to prevent fake-signup farming.
 * Idempotent (referredId is unique) and guards against self-referral.
 */
export async function recordReferral(refCode: string, newSellerId: string): Promise<void> {
  const code = (refCode || "").trim();
  if (!code) return;

  const referrer = await prisma.seller.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
  if (!referrer || referrer.id === newSellerId) return;

  try {
    await prisma.referral.create({
      data: { referrerId: referrer.id, referredId: newSellerId, status: "signed_up" },
    });
  } catch {
    // already recorded for this referred account
  }
}

/**
 * Called when a referred vendor actually subscribes to Growth. Rewards the
 * referrer exactly once (status flips signed_up → rewarded).
 */
export async function grantReferralRewardForConversion(referredSellerId: string): Promise<void> {
  const ref = await prisma.referral.findUnique({ where: { referredId: referredSellerId } });
  if (!ref || ref.status === "rewarded") return;
  await grantReferralReward(ref.referrerId, ref.id);
  await prisma.referral.update({
    where: { id: ref.id },
    data: { status: "rewarded", rewardGrantedAt: new Date() },
  });
}
