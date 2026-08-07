/**
 * Shared DropMeet vocabulary. No server imports — the map, cards, and filter
 * bar all run on the client and need these labels.
 */

export const LOCATION_TYPES = {
  market: "Market",
  retail: "Retail",
  food_hall: "Food hall",
  brewery: "Brewery",
  cafe: "Café",
  church: "Church",
  park: "Park",
  community_center: "Community center",
  festival_ground: "Festival ground",
  shopping_center: "Shopping center",
  school: "School",
  private_venue: "Private venue",
  popup_venue: "Pop-up venue",
  public_space: "Public space",
  other: "Other",
} as const;

export type LocationType = keyof typeof LOCATION_TYPES;

export const MARKET_TYPES = {
  farmers_market: "Farmers market",
  flea_market: "Flea market",
  vintage_market: "Vintage market",
  makers_market: "Makers market",
  artisan_market: "Artisan market",
  swap_meet: "Swap meet",
  food_market: "Food market",
  popup_market: "Pop-up market",
  community_market: "Community market",
  other: "Market",
} as const;

export type MarketType = keyof typeof MARKET_TYPES;

export const EVENT_TYPES = {
  market: "Market",
  street_fair: "Street fair",
  festival: "Festival",
  night_market: "Night market",
  popup: "Pop-up",
  holiday_fair: "Holiday fair",
  other: "Event",
} as const;

export type EventType = keyof typeof EVENT_TYPES;

/** Shared moderation vocabulary. */
export const STATUSES = ["pending", "approved", "rejected", "duplicate", "needs_information"] as const;
export type EntityStatus = (typeof STATUSES)[number];

export const VERIFICATION_STATUSES = {
  verified: "Verified",
  organizer_claimed: "Organizer managed",
  community_submitted: "Community added",
  imported: "Listed from public info",
  needs_verification: "Unverified",
} as const;

export type VerificationStatus = keyof typeof VERIFICATION_STATUSES;

/**
 * Public-facing verification copy. Deliberately avoids implying DropQ endorses
 * a market just because we found it in a public directory — "Listed from public
 * info" is a provenance statement, not a recommendation.
 */
export const VERIFICATION_PUBLIC_LABEL: Record<VerificationStatus, string | null> = {
  verified: "Verified by DropQ",
  organizer_claimed: "Managed by the organizer",
  community_submitted: "Added by the community",
  imported: "Listed from public info",
  needs_verification: null, // show nothing rather than cast doubt on a live page
};

export function locationTypeLabel(t?: string | null): string {
  return LOCATION_TYPES[(t ?? "other") as LocationType] ?? "Place";
}

export function marketTypeLabel(t?: string | null): string {
  return MARKET_TYPES[(t ?? "other") as MarketType] ?? "Market";
}

export function eventTypeLabel(t?: string | null): string {
  return EVENT_TYPES[(t ?? "other") as EventType] ?? "Event";
}

// ── Filters ────────────────────────────────────────────────────────────────

export const FILTERS = [
  { key: "today", label: "Today" },
  { key: "weekend", label: "This weekend" },
  { key: "farmers_market", label: "Farmers markets" },
  { key: "vintage_market", label: "Vintage" },
  { key: "flea_market", label: "Flea markets" },
  { key: "makers_market", label: "Makers markets" },
  { key: "food", label: "Food" },
  { key: "events", label: "Events" },
  { key: "vendors", label: "DropQ vendors" },
  { key: "preorder", label: "Preorder available" },
] as const;

export type FilterKey = (typeof FILTERS)[number]["key"];

export function isFilterKey(v: string): v is FilterKey {
  return FILTERS.some((f) => f.key === v);
}

/** One entry in the map/list feed, whatever its underlying entity. */
export type DropMeetItem = {
  kind: "market" | "location" | "event";
  id: string;
  slug: string;
  name: string;
  href: string;
  latitude: number;
  longitude: number;
  typeLabel: string;
  city: string | null;
  address: string | null;
  imageUrl: string | null;
  /** "SATURDAY · 8 AM–2 PM" — null when nothing is scheduled ahead. */
  whenLabel: string | null;
  nextStart: string | null; // ISO
  nextEnd: string | null; // ISO
  /** DropQ vendors with a confirmed appearance in the window. */
  vendorCount: number;
  /** How many of those have an active preorderable drop. */
  preorderCount: number;
  verification: VerificationStatus;
};
