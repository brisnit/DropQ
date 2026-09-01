import "server-only";
import type Stripe from "stripe";

// The plain limits live in a module the browser can import too, so the drop
// editor and this file cannot drift apart on what the floor is.
export {
  MINIMUM_TOTAL_ERROR,
  MIN_PRODUCT_PRICE_CENTS,
  PRODUCT_MINIMUM_ERROR,
  STRIPE_MIN_TOTAL_CENTS,
  UNSELLABLE_ITEM_ERROR,
  belowProductMinimum,
  belowStripeMinimum,
  hasBelowMinimumUnitPrice,
} from "@/lib/checkout-limits";

/**
 * The Stripe Checkout Session parameters for a DropQ order — built in one place
 * so online checkout and the future walk-up flow cannot drift apart.
 *
 * PHASE C2: a **behaviour-preserving extraction**, nothing more. Every field
 * below was lifted verbatim from the inline object in
 * `lib/actions/order.ts` (`placeOrderAction`), which remains its only caller.
 * Phase E will add the second caller.
 *
 * ⚠️ This builds params only — it does NOT call Stripe. The
 * `stripe.checkout.sessions.create(params, { stripeAccount })` call stays at the
 * call site, because the connected-account context belongs to the caller and
 * because keeping the network call out of here is what makes the whole thing
 * unit-testable against a golden snapshot with no Stripe involved.
 *
 * ⚠️ Do NOT "improve" the session here. Adding tax, shipping, phone collection,
 * saved cards or anything else changes live checkout for every DropQ vendor.
 * That is a payment-feature decision, not a refactor.
 */

export type CheckoutLine = {
  /** Snapshot price in cents at the time of ordering. */
  priceCents: number;
  quantity: number;
  name: string;
  description?: string | null;
};

export type CheckoutSessionInput = {
  orderId: string;
  buyerEmail: string;
  lines: CheckoutLine[];
  /** DropQ's platform fee, in cents. Always the `application_fee_amount`. */
  feeCents: number;
  /**
   * `true` when `Seller.feeMode === "pass"` — the fee becomes a visible
   * "Service fee" line the customer pays on top. In `absorb` mode (the default)
   * the fee is taken from the vendor's proceeds and never shown.
   */
  passFee: boolean;
  successUrl: string;
  cancelUrl: string;
  /**
   * Unix seconds. Injected rather than computed inside so the builder is pure
   * and its output is deterministic in tests. Callers pass
   * `Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS`.
   */
  expiresAt: number;
};

/**
 * The amount Stripe will actually charge for these params.
 *
 * Deliberately derived from the SAME inputs buildCheckoutSessionParams uses,
 * not from a caller's running total, so the number that gets validated is the
 * number that gets sent. A self-test sums the built `line_items` and asserts it
 * equals this, so the two cannot drift apart unnoticed.
 */
export function checkoutSessionTotalCents(
  input: Pick<CheckoutSessionInput, "lines" | "feeCents" | "passFee">
): number {
  const items = input.lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
  return input.passFee ? items + input.feeCents : items;
}

/**
 * How long a Checkout Session stays payable. Bounds how long an order can sit
 * `pending` so `reconcilePendingOrders` can definitively finalize or cancel an
 * abandoned checkout. Stripe's minimum is 30 minutes.
 */
export const SESSION_TTL_SECONDS = 60 * 60;

/** Default `expires_at` for a session created now. */
export function defaultExpiresAt(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS;
}

export function buildCheckoutSessionParams(
  input: CheckoutSessionInput
): Stripe.Checkout.SessionCreateParams {
  const { orderId, buyerEmail, lines, feeCents, passFee } = input;

  return {
    mode: "payment",
    customer_email: buyerEmail,
    line_items: [
      ...lines.map((l) => ({
        quantity: l.quantity,
        price_data: {
          currency: "usd" as const,
          unit_amount: l.priceCents,
          product_data: {
            name: l.name,
            ...(l.description ? { description: l.description } : {}),
          },
        },
      })),
      // In "pass" mode, the DropQ fee is a separate line the customer pays.
      ...(passFee
        ? [
            {
              quantity: 1,
              price_data: {
                currency: "usd" as const,
                unit_amount: feeCents,
                product_data: { name: "Service fee" },
              },
            },
          ]
        : []),
    ],
    payment_intent_data: {
      // DropQ's clean platform cut. The vendor (merchant of record on this
      // direct charge) covers Stripe's processing fee.
      application_fee_amount: feeCents,
      metadata: { orderId },
    },
    metadata: { orderId },
    expires_at: input.expiresAt,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
}
