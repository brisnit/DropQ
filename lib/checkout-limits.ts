/**
 * Payment limits shared by the server and the browser.
 *
 * NO `server-only` HERE, deliberately. The drop editor needs the product floor
 * to give a vendor immediate feedback, and lib/checkout-session.ts — where
 * these started — is server-only because it builds Stripe params. Splitting the
 * plain numbers out is what lets one definition serve both sides instead of the
 * client keeping its own copy that silently drifts.
 *
 * Pure values and pure functions only. Nothing here may reach a database, a
 * secret, or Stripe.
 */

/**
 * Stripe's floor for a Checkout Session, in cents.
 *
 * Stripe rejects any session whose line items sum below this with
 * `invalid_request_error` / `amount_too_small`, and it does so at
 * `sessions.create` — after we have already written an Order row. On 31 Aug
 * 2026 a live drop priced at $0.10 and $0.20 produced a $0.30 cart, a 500 for
 * the buyer, and a pending order that no cleanup job could see.
 *
 * The value is $0.50 for USD. Every DropQ session is created with
 * `currency: "usd"`, so one constant is correct today. If a second currency is
 * ever added this becomes a lookup and every caller must be revisited — the
 * floor differs per currency and Stripe publishes it per currency.
 */
export const STRIPE_MIN_TOTAL_CENTS = 50;

/** What a buyer is told. Never Stripe's raw message. */
export const MINIMUM_TOTAL_ERROR = "Order total must be at least $0.50.";

/**
 * The lowest price a SELLABLE product may carry, in cents.
 *
 * Derived from Stripe's floor rather than chosen independently: a product
 * cheaper than the floor can only ever be sold in a bundle, and a vendor
 * pricing a single item at $0.20 is building a listing that fails at the last
 * step for anyone who buys just that one.
 *
 * This is a SECOND line of defence in front of the cart-total check, not a
 * replacement for it — a cart can still land under the floor through quantities
 * and fee modes, and the total is what Stripe actually judges.
 */
export const MIN_PRODUCT_PRICE_CENTS = STRIPE_MIN_TOTAL_CENTS;

/** What a vendor is told. Names the number, so it is actionable. */
export const PRODUCT_MINIMUM_ERROR =
  "Price must be at least $0.50 — payments can't be processed below that.";

/** True when Stripe would refuse this total. */
export function belowStripeMinimum(totalCents: number): boolean {
  return totalCents < STRIPE_MIN_TOTAL_CENTS;
}

/** True when a product price is too low to be sold on its own. */
export function belowProductMinimum(priceCents: number): boolean {
  return priceCents < MIN_PRODUCT_PRICE_CENTS;
}

/**
 * A DropQ product rule that is deliberately STRICTER than Stripe's.
 *
 * Stripe only judges the cart TOTAL, so three 20c items would satisfy it. DropQ
 * additionally requires every unit price to clear the floor, because a listing
 * priced below it is one a customer can never buy on its own — and "you may
 * only buy this in threes" is not a shop, it is a bug with a workaround.
 *
 * Enforced at four points: the vendor cannot save one, cannot publish a drop
 * containing one, the customer cannot add one to a cart, and checkout refuses
 * the line even when the cart total would have passed.
 */
export function hasBelowMinimumUnitPrice(
  lines: readonly { priceCents: number }[]
): boolean {
  return lines.some((l) => belowProductMinimum(l.priceCents));
}

/** What a customer is told about an item they cannot buy. */
export const UNSELLABLE_ITEM_ERROR =
  "This item is unavailable because its price is below the $0.50 minimum.";
