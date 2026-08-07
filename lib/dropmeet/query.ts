import "server-only";
import { prisma } from "@/lib/db";
import { isOrderingOpen } from "@/lib/drop-status";
import { activeRegion, clampBoundsToRegion, type RegionGeo } from "@/lib/dropmeet/geo";
import {
  expandOccurrences,
  formatTime,
  todayWindow,
  weekendWindow,
  localDateKey,
  type Occurrence,
} from "@/lib/dropmeet/schedule";
import {
  marketTypeLabel,
  locationTypeLabel,
  eventTypeLabel,
  type DropMeetItem,
  type FilterKey,
  type VerificationStatus,
} from "@/lib/dropmeet/types";

/**
 * The DropMeet read layer.
 *
 * Two invariants hold on every public query here, without exception:
 *   1. status === "approved" — nothing pending, rejected, or duplicate escapes.
 *   2. the row sits inside the active region.
 *
 * Both are applied in the `where` clause rather than filtered afterwards, so
 * there is no code path that returns an unapproved place by accident.
 */

export const REGION_TZ = "America/Los_Angeles";
const LOOKAHEAD_DAYS = 21;

export type Bounds = { minLat: number; minLng: number; maxLat: number; maxLng: number };

export type FeedOptions = {
  bounds?: Bounds | null;
  q?: string | null;
  filters?: FilterKey[];
  now?: Date;
  limit?: number;
};

/** Approved-and-in-region, the only shape a public query may take. */
function publicScope(regionId: string) {
  return { regionId, status: "approved" } as const;
}

function boundsWhere(bounds: Bounds | null | undefined) {
  if (!bounds) return {};
  return {
    latitude: { gte: bounds.minLat, lte: bounds.maxLat },
    longitude: { gte: bounds.minLng, lte: bounds.maxLng },
  };
}

/** Resolve the requested date window from the active filters. */
function resolveWindow(filters: FilterKey[], now: Date) {
  if (filters.includes("today")) return { ...todayWindow(now, REGION_TZ), days: 1 };
  if (filters.includes("weekend")) {
    const w = weekendWindow(now, REGION_TZ);
    return { ...w, days: Math.ceil((w.to.getTime() - w.from.getTime()) / 86_400_000) + 1 };
  }
  return {
    from: now,
    to: new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000),
    days: LOOKAHEAD_DAYS,
  };
}

const MARKET_TYPE_FILTERS: Partial<Record<FilterKey, string[]>> = {
  farmers_market: ["farmers_market"],
  vintage_market: ["vintage_market"],
  flea_market: ["flea_market", "swap_meet"],
  makers_market: ["makers_market", "artisan_market"],
  food: ["food_market", "farmers_market"],
};

function whenLabelFor(occ: Occurrence | null): string | null {
  if (!occ) return null;
  const day = new Date(occ.start).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: REGION_TZ,
  });
  if (!occ.startTime || !occ.endTime) return day.toUpperCase();
  return `${day.toUpperCase()} · ${formatTime(occ.startTime)}–${formatTime(occ.endTime)}`;
}

/**
 * Count DropQ vendors appearing at each entity in the window, and how many of
 * those have a drop customers can actually preorder right now.
 *
 * Preorder status is decided by the existing drop rules (isOrderingOpen), not a
 * separate notion of "active" — a drop that has closed for orders must never
 * show a Preorder button on DropMeet.
 */
async function appearanceCounts(
  ids: { marketIds: string[]; locationIds: string[]; eventIds: string[] },
  from: Date,
  to: Date
) {
  const all = [...ids.marketIds, ...ids.locationIds, ...ids.eventIds];
  if (all.length === 0) return new Map<string, { vendors: number; preorders: number }>();

  const appearances = await prisma.vendorAppearance.findMany({
    where: {
      status: { in: ["scheduled", "confirmed"] },
      startDateTime: { gte: from, lte: to },
      OR: [
        ids.marketIds.length ? { marketId: { in: ids.marketIds } } : undefined,
        ids.locationIds.length ? { locationId: { in: ids.locationIds } } : undefined,
        ids.eventIds.length ? { eventId: { in: ids.eventIds } } : undefined,
      ].filter(Boolean) as object[],
    },
    select: {
      sellerId: true,
      marketId: true,
      locationId: true,
      eventId: true,
      drop: {
        select: {
          id: true,
          status: true,
          mode: true,
          opensAt: true,
          closesAt: true,
        },
      },
    },
  });

  const now = new Date();
  const acc = new Map<string, { vendors: Set<string>; preorders: Set<string> }>();
  const bump = (key: string | null, sellerId: string, preorder: boolean) => {
    if (!key) return;
    let e = acc.get(key);
    if (!e) {
      e = { vendors: new Set(), preorders: new Set() };
      acc.set(key, e);
    }
    e.vendors.add(sellerId);
    if (preorder) e.preorders.add(sellerId);
  };

  for (const a of appearances) {
    const preorder =
      !!a.drop && a.drop.status === "live" && isOrderingOpen({ ...a.drop }, now);
    bump(a.marketId, a.sellerId, preorder);
    bump(a.locationId, a.sellerId, preorder);
    bump(a.eventId, a.sellerId, preorder);
  }

  const out = new Map<string, { vendors: number; preorders: number }>();
  for (const [k, v] of acc) out.set(k, { vendors: v.vendors.size, preorders: v.preorders.size });
  return out;
}

/**
 * The unified map + list feed. Returns markets, standalone locations, and
 * events in one ranked list, each with its next occurrence and vendor counts.
 */
export async function dropMeetFeed(opts: FeedOptions = {}): Promise<{
  region: RegionGeo | null;
  items: DropMeetItem[];
}> {
  const region = await activeRegion();
  if (!region) return { region: null, items: [] };

  const now = opts.now ?? new Date();
  const filters = opts.filters ?? [];
  const limit = opts.limit ?? 200;
  const q = opts.q?.trim() || null;
  const win = resolveWindow(filters, now);

  const bounds = opts.bounds ? clampBoundsToRegion(opts.bounds, region) : null;
  const geo = boundsWhere(bounds);

  const wantsEventsOnly = filters.includes("events");
  const marketTypeFilter = filters
    .flatMap((f) => MARKET_TYPE_FILTERS[f] ?? [])
    .filter((v, i, a) => a.indexOf(v) === i);

  const search = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  // ── Markets ──────────────────────────────────────────────────────────────
  const markets = wantsEventsOnly
    ? []
    : await prisma.market.findMany({
        where: {
          ...publicScope(region.id),
          ...(marketTypeFilter.length ? { marketType: { in: marketTypeFilter } } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { description: { contains: q, mode: "insensitive" } },
                  { location: { city: { contains: q, mode: "insensitive" } } },
                ],
              }
            : {}),
          location: { status: "approved", ...geo },
        },
        take: limit,
        include: {
          location: {
            select: { latitude: true, longitude: true, city: true, address: true },
          },
          schedules: { where: { active: true } },
          exceptions: true,
        },
      });

  // ── Standalone locations (places with no market attached) ────────────────
  const locations =
    wantsEventsOnly || marketTypeFilter.length
      ? []
      : await prisma.location.findMany({
          where: {
            ...publicScope(region.id),
            ...geo,
            ...search,
            markets: { none: {} },
          },
          take: limit,
        });

  // ── Events ───────────────────────────────────────────────────────────────
  const events = marketTypeFilter.length
    ? []
    : await prisma.event.findMany({
        where: {
          ...publicScope(region.id),
          ...geo,
          ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}),
          startDateTime: { gte: win.from, lte: win.to },
        },
        take: limit,
        orderBy: { startDateTime: "asc" },
      });

  const counts = await appearanceCounts(
    {
      marketIds: markets.map((m) => m.id),
      locationIds: locations.map((l) => l.id),
      eventIds: events.map((e) => e.id),
    },
    win.from,
    win.to
  );

  const items: DropMeetItem[] = [];

  for (const m of markets) {
    const occurrences = expandOccurrences(m.schedules, m.exceptions, {
      from: win.from,
      days: win.days,
      timezone: REGION_TZ,
    });
    const next = occurrences.find((o) => !o.cancelled && o.end.getTime() >= now.getTime()) ?? null;

    // A date filter is a hard filter: no occurrence in the window means the
    // market genuinely isn't happening then.
    if ((filters.includes("today") || filters.includes("weekend")) && !next) continue;

    const c = counts.get(m.id) ?? { vendors: 0, preorders: 0 };
    items.push({
      kind: "market",
      id: m.id,
      slug: m.slug,
      name: m.name,
      href: `/dropmeet/markets/${m.slug}`,
      latitude: m.location.latitude,
      longitude: m.location.longitude,
      typeLabel: marketTypeLabel(m.marketType),
      city: m.location.city,
      address: m.location.address,
      imageUrl: m.imageUrl,
      whenLabel: whenLabelFor(next),
      nextStart: next?.start.toISOString() ?? null,
      nextEnd: next?.end.toISOString() ?? null,
      vendorCount: c.vendors,
      preorderCount: c.preorders,
      verification: m.verificationStatus as VerificationStatus,
    });
  }

  for (const l of locations) {
    const c = counts.get(l.id) ?? { vendors: 0, preorders: 0 };
    // Locations have no schedule of their own; a date filter keeps only those
    // with a vendor actually turning up in the window.
    if ((filters.includes("today") || filters.includes("weekend")) && c.vendors === 0) continue;

    items.push({
      kind: "location",
      id: l.id,
      slug: l.slug,
      name: l.name,
      href: `/dropmeet/locations/${l.slug}`,
      latitude: l.latitude,
      longitude: l.longitude,
      typeLabel: locationTypeLabel(l.locationType),
      city: l.city,
      address: l.address,
      imageUrl: l.imageUrl,
      whenLabel: null,
      nextStart: null,
      nextEnd: null,
      vendorCount: c.vendors,
      preorderCount: c.preorders,
      verification: l.verificationStatus as VerificationStatus,
    });
  }

  for (const e of events) {
    const c = counts.get(e.id) ?? { vendors: 0, preorders: 0 };
    const day = e.startDateTime.toLocaleDateString("en-US", { weekday: "long", timeZone: REGION_TZ });
    const t = e.startDateTime.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: REGION_TZ,
    });
    items.push({
      kind: "event",
      id: e.id,
      slug: e.slug,
      name: e.name,
      href: `/dropmeet/events/${e.slug}`,
      latitude: e.latitude,
      longitude: e.longitude,
      typeLabel: eventTypeLabel(e.eventType),
      city: null,
      address: null,
      imageUrl: e.imageUrl,
      whenLabel: `${day.toUpperCase()} · ${t}`,
      nextStart: e.startDateTime.toISOString(),
      nextEnd: e.endDateTime?.toISOString() ?? null,
      vendorCount: c.vendors,
      preorderCount: c.preorders,
      verification: e.verificationStatus as VerificationStatus,
    });
  }

  let out = items;
  if (filters.includes("vendors")) out = out.filter((i) => i.vendorCount > 0);
  if (filters.includes("preorder")) out = out.filter((i) => i.preorderCount > 0);

  // Rank: preorders first (that's the commerce loop), then vendor presence,
  // then whatever is happening soonest.
  out.sort((a, b) => {
    if (b.preorderCount !== a.preorderCount) return b.preorderCount - a.preorderCount;
    if (b.vendorCount !== a.vendorCount) return b.vendorCount - a.vendorCount;
    const at = a.nextStart ? Date.parse(a.nextStart) : Number.MAX_SAFE_INTEGER;
    const bt = b.nextStart ? Date.parse(b.nextStart) : Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.name.localeCompare(b.name);
  });

  return { region, items: out.slice(0, limit) };
}

// ── Detail loaders ─────────────────────────────────────────────────────────

/** Vendors appearing at an entity, with preorder state resolved. */
export async function appearancesFor(
  key: { marketId?: string; locationId?: string; eventId?: string },
  opts: { from?: Date; days?: number } = {}
) {
  const from = opts.from ?? new Date();
  const to = new Date(from.getTime() + (opts.days ?? LOOKAHEAD_DAYS) * 86_400_000);

  const rows = await prisma.vendorAppearance.findMany({
    where: {
      ...key,
      status: { in: ["scheduled", "confirmed"] },
      startDateTime: { gte: from, lte: to },
    },
    orderBy: { startDateTime: "asc" },
    include: {
      seller: {
        select: { id: true, slug: true, storeName: true, logoUrl: true, category: true, accent: true },
      },
      drop: {
        select: {
          id: true,
          title: true,
          status: true,
          mode: true,
          opensAt: true,
          closesAt: true,
        },
      },
    },
  });

  const now = new Date();
  return rows.map((a) => {
    const canPreorder = !!a.drop && a.drop.status === "live" && isOrderingOpen({ ...a.drop }, now);
    return {
      id: a.id,
      startDateTime: a.startDateTime,
      endDateTime: a.endDateTime,
      boothInfo: a.boothInfo,
      notes: a.notes,
      status: a.status,
      seller: a.seller,
      drop: a.drop
        ? {
            id: a.drop.id,
            title: a.drop.title,
            href: `/s/${a.seller.slug}/${a.drop.id}`,
            canPreorder,
            closesAt: a.drop.closesAt,
          }
        : null,
    };
  });
}

export type PublicAppearance = Awaited<ReturnType<typeof appearancesFor>>[number];

/** An approved market by slug, or null. Never returns a pending record. */
export async function publicMarket(slug: string) {
  const region = await activeRegion();
  if (!region) return null;
  return prisma.market.findFirst({
    where: { slug, status: "approved", regionId: region.id },
    include: {
      location: true,
      schedules: { where: { active: true }, orderBy: { dayOfWeek: "asc" } },
      exceptions: { orderBy: { date: "asc" } },
    },
  });
}

export async function publicLocation(slug: string) {
  const region = await activeRegion();
  if (!region) return null;
  return prisma.location.findFirst({
    where: { slug, status: "approved", regionId: region.id },
    include: {
      markets: {
        where: { status: "approved" },
        include: { schedules: { where: { active: true } }, exceptions: true },
      },
      events: {
        where: { status: "approved", startDateTime: { gte: new Date() } },
        orderBy: { startDateTime: "asc" },
        take: 10,
      },
    },
  });
}

export async function publicEvent(slug: string) {
  const region = await activeRegion();
  if (!region) return null;
  return prisma.event.findFirst({
    where: { slug, status: "approved", regionId: region.id },
    include: { location: true, market: { select: { slug: true, name: true } } },
  });
}

/** Upcoming appearances for a vendor's public profile. */
export async function vendorUpcomingAppearances(sellerId: string, take = 8) {
  const rows = await prisma.vendorAppearance.findMany({
    where: {
      sellerId,
      status: { in: ["scheduled", "confirmed"] },
      startDateTime: { gte: new Date() },
      // Only surface appearances at places that are actually public.
      OR: [
        { market: { status: "approved" } },
        { location: { status: "approved" } },
        { event: { status: "approved" } },
      ],
    },
    orderBy: { startDateTime: "asc" },
    take,
    include: {
      market: { select: { slug: true, name: true } },
      location: { select: { slug: true, name: true, city: true } },
      event: { select: { slug: true, name: true } },
      drop: { select: { id: true, title: true, status: true, mode: true, opensAt: true, closesAt: true } },
      seller: { select: { slug: true } },
    },
  });

  const now = new Date();
  return rows.map((a) => {
    const place = a.market
      ? { name: a.market.name, href: `/dropmeet/markets/${a.market.slug}` }
      : a.location
        ? { name: a.location.name, href: `/dropmeet/locations/${a.location.slug}` }
        : a.event
          ? { name: a.event.name, href: `/dropmeet/events/${a.event.slug}` }
          : null;
    const canPreorder = !!a.drop && a.drop.status === "live" && isOrderingOpen({ ...a.drop }, now);
    return {
      id: a.id,
      start: a.startDateTime,
      end: a.endDateTime,
      place,
      dropHref: a.drop ? `/s/${a.seller.slug}/${a.drop.id}` : null,
      canPreorder,
      boothInfo: a.boothInfo,
    };
  });
}

/** Next occurrences for a market detail page. */
export function upcomingOccurrences(
  market: { schedules: Parameters<typeof expandOccurrences>[0]; exceptions: Parameters<typeof expandOccurrences>[1] },
  from = new Date(),
  days = 42
) {
  return expandOccurrences(market.schedules, market.exceptions, {
    from,
    days,
    timezone: REGION_TZ,
  }).filter((o) => o.end.getTime() >= from.getTime());
}

export { localDateKey };
