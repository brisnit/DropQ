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
 * Reward the referrer with 1 free month of Growth. Paying (Stripe) vendors get a
 * billing credit; everyone else gets bonus Growth-level access in the database.
 */
async function grantReferralReward(referrerId: string): Promise<void> {
  const referrer = await prisma.seller.findUnique({ where: { id: referrerId } });
  if (!referrer) return;

  let creditApplied = false;
  if (referrer.stripeCustomerId && referrer.subscriptionStatus === "active") {
    const stripe = getStripe();
    if (stripe) {
      try {
        await stripe.customers.createBalanceTransaction(referrer.stripeCustomerId, {
          amount: -GROWTH_PRICE_CENTS, // negative = credit toward future invoices
          currency: "usd",
          description: "DropQ referral reward — 1 month of Growth",
        });
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
 * Record that a newly-signed-up vendor used refCode, then reward the referrer.
 * Idempotent (referredId is unique) and guards against self-referral.
 */
export async function recordReferralAndReward(
  refCode: string,
  newSellerId: string
): Promise<void> {
  const code = (refCode || "").trim();
  if (!code) return;

  const referrer = await prisma.seller.findUnique({
    where: { referralCode: code },
    select: { id: true },
  });
  if (!referrer || referrer.id === newSellerId) return;

  let referral;
  try {
    referral = await prisma.referral.create({
      data: { referrerId: referrer.id, referredId: newSellerId, status: "signed_up" },
    });
  } catch {
    return; // already recorded for this referred account
  }

  await grantReferralReward(referrer.id);
  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "rewarded", rewardGrantedAt: new Date() },
  });
}
