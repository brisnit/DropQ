import "server-only";
import Stripe from "stripe";
import {
  GROWTH_PRICE_CENTS,
  GROWTH_PRICE_LOOKUP_KEY,
  effectivePlan,
  feePercentForPlan,
} from "@/lib/plans";

let _stripe: Stripe | null = null;

/** Returns a Stripe client, or null when no secret key is configured (demo mode). */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

export function isStripeEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Platform fee percent charged to vendors per transaction. */
export function feePercent(): number {
  const n = parseFloat(process.env.DROPQ_FEE_PERCENT ?? "2");
  return isFinite(n) && n >= 0 ? n : 2;
}

/** Plan fields needed to price a seller's transaction fee. */
type FeeSeller = {
  plan: string;
  partnerExpiresAt: Date | null;
  dropsCreated: number;
  growthBonusUntil?: Date | null;
};

/**
 * The platform fee for one transaction.
 *
 * Pass the seller to get their plan's rate — Pro pays a reduced 1.5%, which is
 * advertised on the pricing page. Omitting the seller falls back to the
 * platform default, which is correct for callers that genuinely have no seller
 * (and is what every caller did before plans affected the fee).
 */
export function calcFeeCents(totalCents: number, seller?: FeeSeller): number {
  const pct = seller
    ? feePercentForPlan(effectivePlan(seller), feePercent())
    : feePercent();
  return Math.round((totalCents * pct) / 100);
}

/**
 * Resolve the recurring Stripe Price ID for the Growth plan. Prefers an explicit
 * STRIPE_GROWTH_PRICE_ID; otherwise finds-or-creates a Price by lookup key so
 * billing works with zero dashboard setup. Idempotent.
 */
export async function ensureGrowthPriceId(stripe: Stripe): Promise<string> {
  const envId = process.env.STRIPE_GROWTH_PRICE_ID;
  if (envId) return envId;

  const existing = await stripe.prices.list({
    lookup_keys: [GROWTH_PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  const found = existing.data[0];

  // Stripe Prices are immutable, so changing the plan price means creating a
  // NEW one. Returning whatever the lookup key points at would keep billing the
  // old amount while the pricing page shows the new one — a silent mismatch
  // that lands on a vendor's card, so the amount is verified, not assumed.
  const matches =
    found &&
    found.unit_amount === GROWTH_PRICE_CENTS &&
    found.currency === "usd" &&
    found.recurring?.interval === "month";
  if (matches) return found.id;

  // Reuse the existing Product when there is one; only the Price is versioned.
  const productId =
    found && typeof found.product === "string"
      ? found.product
      : (
          await stripe.products.create({
            name: "DropQ Basic",
            description: "DropQ Basic plan — unlimited drops and the full selling toolkit.",
          })
        ).id;

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: GROWTH_PRICE_CENTS,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: GROWTH_PRICE_LOOKUP_KEY,
    // Moves the key off the stale Price so the next lookup finds this one.
    // Existing subscriptions keep billing their original Price until migrated.
    transfer_lookup_key: true,
  });
  return price.id;
}
