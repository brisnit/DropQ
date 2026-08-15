import "server-only";
import { isStripeEnabled } from "@/lib/stripe";

/**
 * Payment eligibility — one definition, used by every selling surface.
 *
 * GOVERNING PLATFORM RULE: a real DropQ vendor cannot sell unless their Stripe
 * account is connected and currently charge-ready. DropQ does not support
 * alternative payment processors, so "vendor without Stripe" is an
 * incomplete-onboarding / selling-disabled state, NOT a payment mode.
 *
 * This deliberately lives in its own module rather than inline at each call
 * site: the same condition used to be hand-written in two places
 * (app/s/[slug]/[dropId]/page.tsx and lib/actions/order.ts) and they were free
 * to drift. See docs/IN-PERSON-PAYMENTS-ARCHITECTURE.md §1.8.
 *
 * Server-only, because isStripeEnabled() reads STRIPE_SECRET_KEY, which is not
 * a NEXT_PUBLIC var and does not exist in the browser. The vendor banner is
 * therefore a server component that receives an already-computed reason —
 * it must not try to derive sellability client-side.
 */

export type SellerPaymentState = {
  stripeChargesEnabled: boolean;
  stripeAccountId: string | null;
  disabledAt?: Date | null;
};

/**
 * Can this vendor take money right now?
 *
 * `isStripeEnabled()` false means the PLATFORM has no STRIPE_SECRET_KEY, which
 * only happens in local dev. That is the single situation where the demo
 * checkout path in lib/actions/order.ts is legitimate — in production the key
 * is always set, so this function is the real gate.
 */
export function isVendorSellable(seller: SellerPaymentState): boolean {
  if (!isStripeEnabled()) return true; // local dev with no platform key
  if (seller.disabledAt) return false; // admin-suspended vendor
  return seller.stripeChargesEnabled && !!seller.stripeAccountId;
}

/**
 * Why a vendor can't sell — drives the vendor-facing messaging. The two
 * failure modes are completely different situations and must not share copy:
 *
 *  - "not_connected"    they never finished onboarding
 *  - "charges_disabled" they DID connect, and Stripe has since turned charges
 *                       off (unverified identity, expired document, risk
 *                       review). This can land on an established vendor
 *                       mid-drop via the account.updated webhook, which is why
 *                       it needs its own, more urgent message.
 */
export type SellerBlockReason = "not_connected" | "charges_disabled" | "suspended";

export function sellerBlockReason(
  seller: SellerPaymentState
): SellerBlockReason | null {
  if (isVendorSellable(seller)) return null;
  if (seller.disabledAt) return "suspended";
  if (!seller.stripeAccountId) return "not_connected";
  return "charges_disabled";
}

/** The only values Drop.status may ever hold. */
export const DROP_STATUSES = ["draft", "live", "closed"] as const;

/**
 * Resolve a requested Drop.status against the platform rule.
 *
 * A drop can only go LIVE if its vendor is Stripe charge-ready: a live drop is
 * a public storefront with a checkout, so publishing one while payments are
 * unavailable puts a form in front of customers that cannot take their money.
 *
 * Everything else stays open on purpose:
 *  - drafts remain fully editable, so no work is lost while Stripe is sorted
 *  - live -> closed and live -> draft are ALWAYS allowed, because a vendor
 *    whose Stripe breaks mid-drop must still be able to take the drop down
 *
 * Also whitelists the value. updateDropStatusAction used to write the raw form
 * string, so any value at all could land in the column.
 *
 * Lives here rather than in lib/actions/dashboard.ts because that file is
 * "use server" — every export there must be an async server action, which
 * would make this untestable.
 */
export function resolveDropStatus(
  requested: string,
  current: string,
  seller: SellerPaymentState
): { status: string; blocked: boolean } {
  const status = (DROP_STATUSES as readonly string[]).includes(requested)
    ? requested
    : current;
  if (status === "live" && current !== "live" && !isVendorSellable(seller)) {
    return { status: "draft", blocked: true };
  }
  return { status, blocked: false };
}
