import "server-only";
import Stripe from "stripe";
import { GROWTH_PRICE_CENTS, GROWTH_PRICE_LOOKUP_KEY } from "@/lib/plans";

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

export function calcFeeCents(totalCents: number): number {
  return Math.round((totalCents * feePercent()) / 100);
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
  if (existing.data[0]) return existing.data[0].id;

  const product = await stripe.products.create({
    name: "DropQ Growth",
    description: "DropQ Growth plan — unlimited drops and the full selling toolkit.",
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: GROWTH_PRICE_CENTS,
    currency: "usd",
    recurring: { interval: "month" },
    lookup_key: GROWTH_PRICE_LOOKUP_KEY,
  });
  return price.id;
}
