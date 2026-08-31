import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

/**
 * Vendor attribution.
 *
 * Two distinct questions, deliberately stored in two places:
 *
 *   "Who brought this customer to DropQ?"  → Customer.firstVendorId
 *      Written once, on the first interaction we can attribute, and never
 *      overwritten. A customer acquired by vendor A who later buys from ten
 *      others is still, permanently, A's acquisition.
 *
 *   "Which vendors does this customer deal with?" → CustomerVendor
 *      One row per pair, accumulating follows, orders and spend.
 *
 * Conflating the two would mean the last vendor a customer touched silently
 * stole credit for acquiring them.
 */

const TOUCH_COOKIE = "dq_touch";
const TOUCH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days to convert

/**
 * How a customer first reached DropQ.
 *
 * ⚠️ `qr` and `in_person` are NOT the same thing and must never be merged:
 *   qr        — they scanned a drop/share QR and self-ordered ONLINE
 *               (set by middleware.ts from ?ref=qr / utm_source=qr)
 *   in_person — they were physically with the vendor and entered DropQ through
 *               a vendor-initiated walk-up sale
 * Phase 8's acquisition funnel depends on telling those apart.
 */
export type TouchSource =
  | "storefront" | "drop" | "qr" | "dropmeet" | "checkout" | "direct" | "admin"
  | "in_person";

export type FirstTouch = {
  /// Middleware writes the slug (edge runtime, no Prisma). Server callers may
  /// pass an id directly — either resolves to the same vendor.
  vendorSlug?: string | null;
  vendorId?: string | null;
  dropId?: string | null;
  source: TouchSource;
  detail?: string | null;
  at: string; // ISO
};

/**
 * The first touch is written by middleware.ts, not here: cookies().set() only
 * works in a Server Function or Route Handler, so a page attempting it would
 * silently do nothing. Middleware sets it on the response instead.
 *
 * Kept for Server Actions that legitimately establish a first touch (e.g. a
 * follow from DropMeet, where there's no vendor URL to match on).
 */
export async function recordTouch(touch: Omit<FirstTouch, "at">): Promise<void> {
  try {
    const jar = await cookies();
    if (jar.get(TOUCH_COOKIE)) return; // first write wins

    jar.set(TOUCH_COOKIE, JSON.stringify({ ...touch, at: new Date().toISOString() }), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: TOUCH_MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    // Not a cookie-writable context. Attribution is best-effort — never break
    // the page over it.
  }
}

/** Resolve a touch to a real vendor, whether it carries a slug or an id. */
export async function resolveTouchVendor(touch: FirstTouch) {
  if (touch.vendorId) {
    return prisma.seller.findUnique({
      where: { id: touch.vendorId },
      select: { id: true, slug: true, storeName: true, logoUrl: true, accent: true, internalKind: true },
    });
  }
  if (touch.vendorSlug) {
    return prisma.seller.findUnique({
      where: { slug: touch.vendorSlug },
      select: { id: true, slug: true, storeName: true, logoUrl: true, accent: true, internalKind: true },
    });
  }
  return null;
}

/**
 * May this vendor be recorded as a customer's acquisition source?
 *
 * No, if the vendor is DropQ-controlled — the demo store, a founder or canary
 * account, staff, the documentation fixture. Someone who looks at the marketing
 * site's demo storefront has not been acquired by a vendor; crediting one would
 * put our own storefront at the top of the customer-acquisition funnel.
 *
 * ⚠️ This check lives HERE, at the point the touch is consumed, and not in
 * middleware. Middleware is edge runtime with no Prisma, so it cannot know a
 * seller's classification without a network call on every storefront request.
 * It records the slug; this decides whether the slug counts. That split also
 * means the answer is always current: reclassifying a vendor changes future
 * attributions without a migration.
 *
 * Uses the existing `internalKind` classification rather than naming any store.
 * A hard-coded slug would be wrong the day a second demo account exists.
 */
export function isEligibleAcquisitionVendor<T extends { internalKind: string | null }>(
  vendor: T | null
): vendor is T {
  return !!vendor && !vendor.internalKind;
}

export async function readTouch(): Promise<FirstTouch | null> {
  try {
    const raw = (await cookies()).get(TOUCH_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirstTouch;
    return parsed?.source ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Stamp acquisition onto a customer. No-op if they already have a first
 * vendor — that's the whole point of first-touch.
 *
 * `authoritative` says the caller's own signal outranks the `dq_touch` cookie.
 * Only the walk-up payment path sets it: the customer was physically standing
 * with the vendor, and a browsing cookie — possibly weeks old, possibly for a
 * different vendor entirely — is not better evidence than that. A real canary
 * sale was credited to a storefront visit from two days earlier before this
 * existed.
 *
 * Everything else keeps cookie-first ordering, where the cookie IS the
 * acquisition evidence. The already-attributed guard below runs first either
 * way, so this can never rewrite an existing customer's acquisition.
 */
export async function applyFirstTouch(
  customerId: string,
  fallback?: Omit<FirstTouch, "at"> | null,
  opts?: { authoritative?: boolean }
): Promise<void> {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, firstVendorId: true, signupSource: true },
    });
    if (!customer) return;
    // Already attributed — never overwrite.
    if (customer.firstVendorId || customer.signupSource) return;

    const provided = fallback ? { ...fallback, at: new Date().toISOString() } : null;
    const touch = opts?.authoritative
      ? (provided ?? (await readTouch()))
      : ((await readTouch()) ?? provided);
    if (!touch) return;

    // Only reference a vendor/drop that still exists.
    const [vendor, drop] = await Promise.all([
      resolveTouchVendor(touch),
      touch.dropId ? prisma.drop.findUnique({ where: { id: touch.dropId }, select: { id: true } }) : null,
    ]);

    /**
     * A DropQ-controlled vendor is not an acquisition source for a BROWSING
     * touch. Someone who looked at the marketing site's demo storefront has not
     * been acquired by a vendor, and crediting one poisons first-touch: it is
     * write-once, so the demo store would permanently block the real vendor who
     * later brings that customer in.
     *
     * ⚠️ AN AUTHORITATIVE TOUCH IS DIFFERENT, and the walk-up self-tests caught
     * this the first time the rule was written too broadly. `authoritative` is
     * set only by the walk-up payment path, where the customer was physically
     * standing with the vendor and a real card was charged. That is a genuine
     * acquisition however the vendor is classified — and the Walk-Up pilot
     * cohort is *defined* by `internalKind`, so refusing internal vendors there
     * would have silently dropped attribution for every walk-up sale DropQ has.
     *
     * The reporting layer still excludes those customers from business numbers
     * through the seller's classification at query time. Recording what
     * happened and excluding it in reports is the right split; blanking the
     * data to achieve a reporting outcome is not.
     */
    if (!opts?.authoritative && !isEligibleAcquisitionVendor(vendor)) {
      if (process.env.NODE_ENV !== "production") {
        const why = vendor === null ? "no such vendor" : "vendor is DropQ-internal";
        console.warn(`[attribution] ignoring browsing touch: ${why}`);
      }
      return;
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        firstVendorId: vendor?.id ?? null,
        firstDropId: drop?.id ?? null,
        signupSource: touch.source,
        signupSourceDetail: touch.detail ?? null,
        firstTouchAt: new Date(touch.at),
      },
    });
  } catch (e) {
    console.error("applyFirstTouch failed:", e);
  }
}

/**
 * Create or update the customer↔vendor relationship. Idempotent per pair.
 *
 * `followedAt` is only ever set by an explicit follow — buying from someone is
 * not consent to be marketed to, so a purchase records the relationship
 * without silently subscribing them.
 */
export async function recordRelationship(input: {
  customerId: string;
  sellerId: string;
  source?: string;
  purchase?: { at: Date; amountCents: number };
  follow?: boolean;
}): Promise<void> {
  const { customerId, sellerId } = input;
  try {
    const existing = await prisma.customerVendor.findUnique({
      where: { customerId_sellerId: { customerId, sellerId } },
    });

    if (!existing) {
      await prisma.customerVendor.create({
        data: {
          customerId,
          sellerId,
          relationshipSource: input.source ?? (input.purchase ? "purchase" : "follow"),
          followedAt: input.follow ? new Date() : null,
          firstPurchaseAt: input.purchase?.at ?? null,
          lastPurchaseAt: input.purchase?.at ?? null,
          orderCount: input.purchase ? 1 : 0,
          totalSpentCents: input.purchase?.amountCents ?? 0,
        },
      });
    } else {
      await prisma.customerVendor.update({
        where: { id: existing.id },
        data: {
          // Never clear an existing follow by recording a later purchase.
          followedAt: input.follow ? existing.followedAt ?? new Date() : existing.followedAt,
          ...(input.purchase
            ? {
                firstPurchaseAt: existing.firstPurchaseAt ?? input.purchase.at,
                lastPurchaseAt: input.purchase.at,
                orderCount: { increment: 1 },
                totalSpentCents: { increment: input.purchase.amountCents },
              }
            : {}),
        },
      });
    }

    if (input.purchase) {
      // Platform-wide first purchase, for the acquisition funnel.
      await prisma.customer.updateMany({
        where: { id: customerId, firstPurchaseAt: null },
        data: { firstPurchaseAt: input.purchase.at },
      });
    }
  } catch (e) {
    console.error("recordRelationship failed:", e);
  }
}

/** Is this customer following this vendor? */
export async function isFollowingVendor(customerId: string, sellerId: string): Promise<boolean> {
  const row = await prisma.customerVendor.findUnique({
    where: { customerId_sellerId: { customerId, sellerId } },
    select: { followedAt: true },
  });
  return !!row?.followedAt;
}

/** Vendors a customer follows, most recently active first. */
export async function followedVendors(customerId: string, take = 50) {
  const rows = await prisma.customerVendor.findMany({
    where: { customerId, followedAt: { not: null } },
    orderBy: [{ lastPurchaseAt: "desc" }, { followedAt: "desc" }],
    take,
    include: {
      seller: {
        select: {
          id: true,
          slug: true,
          storeName: true,
          logoUrl: true,
          accent: true,
          category: true,
          publicCity: true,
          location: true,
          disabledAt: true,
        },
      },
    },
  });
  return rows.filter((r) => !r.seller.disabledAt);
}
