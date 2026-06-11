import "server-only";
import Stripe from "stripe";

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
  const n = parseFloat(process.env.DROPQ_FEE_PERCENT ?? "5");
  return isFinite(n) && n >= 0 ? n : 5;
}

export function calcFeeCents(totalCents: number): number {
  return Math.round((totalCents * feePercent()) / 100);
}
