// Lightweight client analytics for the Vendor Finder. Fire-and-forget beacons to
// /api/track — no cookies, no customer profile, no PII. Also tracks the
// originating vendor (in sessionStorage) so DropQ can tell whether discovery led
// to additional vendor visits/orders.

export type DiscoveryEvent =
  | "discovery_viewed"
  | "location_permission_requested"
  | "location_permission_accepted"
  | "location_permission_denied"
  | "zip_searched"
  | "radius_changed"
  | "category_filter_selected"
  | "discovery_card_opened"
  | "calendar_event_created"
  | "item_saved"
  | "saved_item_removed"
  | "post_checkout_discovery_cta"
  | "storefront_discovery_link"
  | "order_placed_from_discovery"
  | "vendor_discoverability_enabled"
  | "vendor_discoverability_disabled"
  // ── DropMeet ──────────────────────────────────────────────────────────
  // Same beacon, same sink. Names are <noun>_<verb> so they group cleanly
  // when this is pointed at a real analytics pipeline.
  | "dropmeet_opened"
  | "map_moved"
  | "search_used"
  | "location_viewed"
  | "market_viewed"
  | "event_viewed"
  | "vendor_appearance_viewed"
  | "drop_opened_from_dropmeet"
  | "preorder_initiated_from_dropmeet"
  | "directions_clicked"
  | "location_followed"
  | "location_unfollowed"
  | "market_followed"
  | "market_unfollowed"
  | "location_submitted"
  | "market_submitted"
  | "claim_requested"
  | "vendor_appearance_created"
  | "vendor_invited"
  | "location_approved"
  | "location_rejected";

/**
 * Vendor guidance events (onboarding, tour, coachmarks, help).
 *
 * Kept as its own union rather than bolted onto `DiscoveryEvent`, because these
 * describe the VENDOR side of the product and that type is about buyers finding
 * vendors. Both flow through the same `track()` beacon and the same `/api/track`
 * sink, so pointing that sink at a real pipeline still happens in one place.
 *
 * Names follow the `<noun>_<verb>` convention already used above and stay
 * compatible with the vocabulary approved in docs/VENDOR-ACTIVATION.md §13, so
 * nothing here has to be renamed when Phase 8 wires up PostHog.
 */
export type GuidanceEvent =
  | "onboarding_welcome_shown"
  | "onboarding_welcome_dismissed"
  | "onboarding_tour_started"
  | "onboarding_tour_step_viewed"
  | "onboarding_tour_completed"
  | "onboarding_tour_skipped"
  | "coachmark_shown"
  | "coachmark_dismissed"
  | "smart_tip_shown"
  | "smart_tip_clicked"
  | "smart_tip_dismissed"
  | "help_opened"
  | "help_searched"
  | "help_article_viewed"
  | "drop_shared";

/**
 * The exact properties each guidance event may carry.
 *
 * This map is a privacy control, not a convenience. `help_searched` has no
 * `query` field and cannot be given one: the decision on record is that raw
 * free-text search terms are NOT retained, and a typed map makes that a compile
 * error instead of a code-review question. `queryLength` and `zeroResults`
 * answer "is search working?" without keeping what anyone typed.
 *
 * Nothing here may carry an email, a name, a store name or an order id.
 * Vendors are identified by `Seller.id` at the sink, never in these props.
 */
export type GuidanceEventProps = {
  onboarding_welcome_shown: Record<string, never>;
  onboarding_welcome_dismissed: { action: "tour" | "skip" | "close" };
  onboarding_tour_started: { from: "welcome" | "help" };
  onboarding_tour_step_viewed: { step: number; key: string };
  onboarding_tour_completed: { steps: number };
  onboarding_tour_skipped: { step: number };
  coachmark_shown: { id: string };
  coachmark_dismissed: { id: string };
  smart_tip_shown: { id: string };
  smart_tip_clicked: { id: string };
  smart_tip_dismissed: { id: string };
  help_opened: { from: "header" | "menu" | "empty_state" | "coachmark" | "direct" };
  /** Deliberately no `query`. See above. */
  help_searched: { queryLength: number; resultCount: number; zeroResults: boolean };
  help_article_viewed: { slug: string; from: "panel" | "search" | "related" | "direct" };
  drop_shared: { method: "copy" | "share_sheet" | "qr_download" };
};

/**
 * Typed wrapper over `track()` for guidance events. Use this rather than
 * `track()` directly so the props map above is actually enforced.
 */
export function trackGuidance<E extends GuidanceEvent>(
  event: E,
  props: GuidanceEventProps[E]
) {
  track(event, props as Record<string, unknown>);
}

const ORIGIN_KEY = "dropq_origin_vendor";

/** Remember the vendor a customer entered through (QR / link / storefront). */
export function setOriginatingVendor(id: string, slug?: string) {
  if (typeof window === "undefined") return;
  try {
    if (!sessionStorage.getItem(ORIGIN_KEY)) {
      sessionStorage.setItem(ORIGIN_KEY, JSON.stringify({ id, slug: slug ?? null }));
    }
  } catch {
    /* storage disabled — ignore */
  }
}

export function getOriginatingVendor(): { id: string; slug: string | null } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ORIGIN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function track(
  event: DiscoveryEvent | GuidanceEvent,
  props: Record<string, unknown> = {}
) {
  if (typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({
      event,
      props,
      origin: getOriginatingVendor(),
      path: window.location.pathname,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/track", {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      });
    }
  } catch {
    /* never let analytics break the UI */
  }
}
