import "server-only";
import { prisma } from "@/lib/db";
import { distanceMeters } from "@/lib/geofence";
import { computeDropPhase, isOrderingOpen } from "@/lib/drop-status";
import { categoryLabel } from "@/lib/category";

// Public Vendor Finder data layer.
//
// SAFETY: everything returned here is public-safe. We never expose exact
// addresses (pickupAddress/pickupLine1/pickupNotes), raw coordinates, customer
// data, payments, or private/draft drops. Distance is computed server-side from
// coordinates but only the rounded mileage + city-level location is returned.
// Reusable by a future DropMaps feature.

const METERS_PER_MILE = 1609.344;
export const DEFAULT_RADIUS_MILES = 25;
export const RADIUS_CHOICES = [10, 25, 50, 100] as const;

export type DiscoveryItem = {
  kind: "drop" | "vendor";
  id: string; // drop id, or vendor id for vendor-only cards
  vendorId: string;
  vendorSlug: string;
  vendorName: string;
  vendorLogo: string | null;
  headerImage: string | null;
  accent: string;
  title: string | null; // drop title (null for vendor cards)
  category: string;
  categoryLabel: string;
  cityLabel: string | null; // city / neighborhood — never an exact address
  neighborhood: string | null;
  state: string | null;
  publicLocationName: string | null; // a friendly label like "The shop", not an address
  distanceMiles: number | null; // approximate; null when no origin given
  status: DiscoveryStatus;
  statusLabel: string;
  isEvent: boolean; // live pop-up / market
  fulfillment: string | null;
  orderCloseAt: string | null; // ISO
  eventStart: string | null; // ISO
  eventEnd: string | null; // ISO
  href: string;
  rank: number; // lower = higher priority (see spec ordering)
};

export type DiscoveryStatus =
  | "open"
  | "closing_soon"
  | "today"
  | "weekend"
  | "upcoming"
  | "vendor";

type DropTimes = Parameters<typeof computeDropPhase>[0] & {
  pickupStartAt: Date | null;
  pickupEndAt: Date | null;
};

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate();
}

// Is `d` within the coming Sat–Sun window (approx, UTC)?
function isThisWeekend(d: Date, now: Date): boolean {
  const diffDays = (d.getTime() - now.getTime()) / 86_400_000;
  if (diffDays < 0 || diffDays > 7) return false;
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  return dow === 0 || dow === 6;
}

/** Classify a drop into a discovery status + rank, or null if not discoverable. */
function classify(
  drop: DropTimes,
  now: Date
): { rank: number; status: DiscoveryStatus; label: string } | null {
  const isEvent = drop.mode === "live";
  const phase = computeDropPhase(drop, now);
  const open = isOrderingOpen(drop, now);
  const start = drop.pickupStartAt || drop.opensAt || null;
  const SOON = 24 * 3600 * 1000;

  if (open) {
    if (!isEvent && drop.closesAt && drop.closesAt.getTime() - now.getTime() <= SOON) {
      return { rank: 2, status: "closing_soon", label: "Closing Soon" };
    }
    return { rank: 1, status: "open", label: isEvent ? "Live Now" : "Open Now" };
  }
  if (phase === "scheduled") {
    if (start && sameLocalDay(start, now)) return { rank: 3, status: "today", label: "Today" };
    if (start && isThisWeekend(start, now)) return { rank: 4, status: "weekend", label: "This Weekend" };
    return { rank: 5, status: "upcoming", label: "Upcoming" };
  }
  if (phase === "pickup") return { rank: 3, status: "today", label: "Pickup Now" };
  return null; // closed / completed / draft — not discoverable
}

export type DiscoveryQuery = {
  lat?: number | null;
  lng?: number | null;
  radiusMiles?: number;
  category?: string | null; // food | collectibles | apparel | art | events
  when?: string | null; // today | weekend
};

/**
 * Find discoverable vendors + their public drops near an optional origin.
 * When lat/lng are provided, results are filtered to the radius and sorted by
 * priority then distance. Without an origin, returns discoverable items
 * unsorted-by-distance (capped).
 */
export async function findDiscovery(q: DiscoveryQuery): Promise<DiscoveryItem[]> {
  const now = new Date();
  const hasOrigin = typeof q.lat === "number" && typeof q.lng === "number";
  const radiusMeters = (q.radiusMiles ?? DEFAULT_RADIUS_MILES) * METERS_PER_MILE;

  const vendors = await prisma.seller.findMany({
    where: { isDiscoverable: true, disabledAt: null },
    select: {
      id: true, slug: true, storeName: true, logoUrl: true, headerImageUrl: true,
      accent: true, category: true, location: true,
      latitude: true, longitude: true,
      publicCity: true, publicState: true, publicNeighborhood: true,
      showActiveDropsInDiscovery: true, showEventsInDiscovery: true,
      drops: {
        where: { isPublic: true, status: "live" },
        select: {
          id: true, title: true, mode: true, status: true, fulfillment: true,
          opensAt: true, closesAt: true, pickupStartAt: true, pickupEndAt: true,
          pickupLocationName: true, pickupCity: true, pickupState: true,
          pickupLat: true, pickupLng: true,
          products: { select: { inventory: true, sold: true } },
        },
      },
    },
  });

  const items: DiscoveryItem[] = [];

  for (const v of vendors) {
    const cityLabel = v.publicCity || v.location || v.publicNeighborhood || null;
    // City-level distance fallback uses the vendor coordinates (approximate).
    const vendorDist =
      hasOrigin && v.latitude != null && v.longitude != null
        ? distanceMeters(q.lat!, q.lng!, v.latitude, v.longitude)
        : null;

    const eligibleDrops = [] as DiscoveryItem[];
    for (const d of v.drops) {
      const isEvent = d.mode === "live";
      // Respect the vendor's per-type toggles.
      if (isEvent && !v.showEventsInDiscovery) continue;
      if (!isEvent && !v.showActiveDropsInDiscovery) continue;

      // Skip fully sold-out drops (no orderable inventory left).
      const totalInv = d.products.reduce((s, p) => s + p.inventory, 0);
      const totalSold = d.products.reduce((s, p) => s + p.sold, 0);
      if (totalInv > 0 && totalSold >= totalInv) continue;

      const cls = classify(d, now);
      if (!cls) continue;

      // Category filter.
      if (q.category) {
        if (q.category === "events" ? !isEvent : v.category !== q.category) continue;
      }
      // Date filter.
      if (q.when === "today" && cls.status !== "today") continue;
      if (q.when === "weekend" && cls.status !== "weekend") continue;

      // Distance: prefer the drop's own coordinates, else the vendor's.
      const dLat = d.pickupLat ?? v.latitude;
      const dLng = d.pickupLng ?? v.longitude;
      const distM =
        hasOrigin && dLat != null && dLng != null
          ? distanceMeters(q.lat!, q.lng!, dLat, dLng)
          : null;
      if (hasOrigin && distM != null && distM > radiusMeters) continue;
      // If we have an origin but no coords for this drop/vendor, keep it only
      // when the vendor city is unknown too (can't place it) — else skip.
      if (hasOrigin && distM == null) continue;

      eligibleDrops.push({
        kind: "drop",
        id: d.id,
        vendorId: v.id,
        vendorSlug: v.slug,
        vendorName: v.storeName,
        vendorLogo: v.logoUrl,
        headerImage: v.headerImageUrl,
        accent: v.accent,
        title: d.title,
        category: v.category,
        categoryLabel: categoryLabel(v.category),
        cityLabel: d.pickupCity || cityLabel,
        neighborhood: v.publicNeighborhood,
        state: d.pickupState || v.publicState,
        publicLocationName: d.pickupLocationName,
        distanceMiles: distM == null ? null : Math.round((distM / METERS_PER_MILE) * 10) / 10,
        status: cls.status,
        statusLabel: cls.label,
        isEvent,
        fulfillment: d.fulfillment,
        orderCloseAt: d.closesAt ? d.closesAt.toISOString() : null,
        eventStart: (d.pickupStartAt || d.opensAt)?.toISOString() ?? null,
        eventEnd: (d.pickupEndAt || d.closesAt)?.toISOString() ?? null,
        href: `/s/${v.slug}/${d.id}`,
        rank: cls.rank,
      });
    }

    if (eligibleDrops.length) {
      items.push(...eligibleDrops);
    } else if (!q.category || q.category === v.category) {
      // Vendor-only card (priority 6) — only when no date/event filter is active.
      if (q.when || q.category === "events") continue;
      if (hasOrigin && (vendorDist == null || vendorDist > radiusMeters)) continue;
      items.push({
        kind: "vendor",
        id: v.id,
        vendorId: v.id,
        vendorSlug: v.slug,
        vendorName: v.storeName,
        vendorLogo: v.logoUrl,
        headerImage: v.headerImageUrl,
        accent: v.accent,
        title: null,
        category: v.category,
        categoryLabel: categoryLabel(v.category),
        cityLabel,
        neighborhood: v.publicNeighborhood,
        state: v.publicState,
        publicLocationName: null,
        distanceMiles: vendorDist == null ? null : Math.round((vendorDist / METERS_PER_MILE) * 10) / 10,
        status: "vendor",
        statusLabel: "Local vendor",
        isEvent: false,
        fulfillment: null,
        orderCloseAt: null,
        eventStart: null,
        eventEnd: null,
        href: `/s/${v.slug}`,
        rank: 6,
      });
    }
  }

  // Sort: priority tier, then nearest, then soonest.
  items.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const da = a.distanceMiles ?? Infinity;
    const db = b.distanceMiles ?? Infinity;
    if (da !== db) return da - db;
    const ta = a.eventStart ? Date.parse(a.eventStart) : Infinity;
    const tb = b.eventStart ? Date.parse(b.eventStart) : Infinity;
    return ta - tb;
  });

  return items.slice(0, 100);
}
