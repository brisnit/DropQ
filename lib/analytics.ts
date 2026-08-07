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

export function track(event: DiscoveryEvent, props: Record<string, unknown> = {}) {
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
