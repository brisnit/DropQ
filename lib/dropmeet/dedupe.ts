import "server-only";
import { prisma } from "@/lib/db";
import { distanceMeters } from "@/lib/geofence";

/**
 * Duplicate detection for inbound places.
 *
 * The same market gets submitted by two neighbours and scraped from a city
 * calendar, arriving as "Hillcrest Farmers Market", "Hillcrest Farmer's Mkt",
 * and "HILLCREST FARMERS MARKET (Sundays)". We surface likely matches with a
 * score and let an admin decide.
 *
 * Nothing here merges anything. Automatic merging on a fuzzy score is how you
 * silently destroy a real record that happened to sit near another one.
 */

const NEAR_METERS = 250;

/** Strip case, punctuation, and the noise words that make market names differ. */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(the|a|an|of|at|in|on|market|markets|mkt|farmers|farmer|certified|weekly|monthly|san diego|sd|ca|california)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHost(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

/** Token overlap (Jaccard) on normalized names — 0…1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export type DuplicateMatch = {
  id: string;
  name: string;
  slug: string;
  status: string;
  address: string | null;
  distanceMeters: number | null;
  score: number;
  reasons: string[];
};

type Candidate = {
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  websiteUrl?: string | null;
  phone?: string | null;
};

/**
 * Score an inbound place against existing Locations. Includes pending rows on
 * purpose — the commonest duplicate is the one already sitting in the queue.
 */
export async function findLocationDuplicates(
  input: Candidate,
  regionId: string,
  excludeId?: string
): Promise<DuplicateMatch[]> {
  // Cheap geographic pre-filter (~0.01° ≈ 1.1km) so we score a handful of rows,
  // not the whole table.
  const near =
    input.latitude != null && input.longitude != null
      ? {
          latitude: { gte: input.latitude - 0.02, lte: input.latitude + 0.02 },
          longitude: { gte: input.longitude - 0.02, lte: input.longitude + 0.02 },
        }
      : {};

  const host = normalizeHost(input.websiteUrl);
  const phone = normalizePhone(input.phone);

  const rows = await prisma.location.findMany({
    where: {
      regionId,
      status: { in: ["approved", "pending", "needs_information"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...near,
    },
    take: 60,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      address: true,
      latitude: true,
      longitude: true,
      websiteUrl: true,
      phone: true,
    },
  });

  const matches: DuplicateMatch[] = [];

  for (const r of rows) {
    const reasons: string[] = [];
    let score = 0;

    const sim = nameSimilarity(input.name, r.name);
    if (sim >= 0.9) {
      score += 0.55;
      reasons.push("near-identical name");
    } else if (sim >= 0.5) {
      score += 0.3;
      reasons.push("similar name");
    }

    let dist: number | null = null;
    if (input.latitude != null && input.longitude != null) {
      dist = distanceMeters(input.latitude, input.longitude, r.latitude, r.longitude);
      if (dist <= 60) {
        score += 0.4;
        reasons.push("same spot (<60m)");
      } else if (dist <= NEAR_METERS) {
        score += 0.25;
        reasons.push(`${Math.round(dist)}m away`);
      }
    }

    const rHost = normalizeHost(r.websiteUrl);
    if (host && rHost && host === rHost) {
      score += 0.35;
      reasons.push("same website");
    }

    const rPhone = normalizePhone(r.phone);
    if (phone && rPhone && phone === rPhone) {
      score += 0.35;
      reasons.push("same phone");
    }

    if (score >= 0.45 && reasons.length > 0) {
      matches.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        address: r.address,
        distanceMeters: dist,
        score: Math.min(1, score),
        reasons,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Same idea for markets, keyed off their location rather than raw coordinates. */
export async function findMarketDuplicates(
  input: { name: string; locationId?: string | null; websiteUrl?: string | null },
  regionId: string,
  excludeId?: string
): Promise<DuplicateMatch[]> {
  const host = normalizeHost(input.websiteUrl);

  const rows = await prisma.market.findMany({
    where: {
      regionId,
      status: { in: ["approved", "pending", "needs_information"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    take: 100,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      locationId: true,
      websiteUrl: true,
      location: { select: { address: true } },
    },
  });

  const matches: DuplicateMatch[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    let score = 0;

    const sim = nameSimilarity(input.name, r.name);
    if (sim >= 0.9) {
      score += 0.55;
      reasons.push("near-identical name");
    } else if (sim >= 0.5) {
      score += 0.3;
      reasons.push("similar name");
    }

    if (input.locationId && r.locationId === input.locationId) {
      score += 0.4;
      reasons.push("same location");
    }

    const rHost = normalizeHost(r.websiteUrl);
    if (host && rHost && host === rHost) {
      score += 0.35;
      reasons.push("same website");
    }

    if (score >= 0.45 && reasons.length > 0) {
      matches.push({
        id: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        address: r.location?.address ?? null,
        distanceMeters: null,
        score: Math.min(1, score),
        reasons,
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Unique, URL-safe slug within a table. */
export async function uniqueSlug(
  base: string,
  table: "location" | "market" | "event"
): Promise<string> {
  const root =
    base
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "place";

  for (let i = 0; i < 50; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    const exists =
      table === "location"
        ? await prisma.location.findUnique({ where: { slug }, select: { id: true } })
        : table === "market"
          ? await prisma.market.findUnique({ where: { slug }, select: { id: true } })
          : await prisma.event.findUnique({ where: { slug }, select: { id: true } });
    if (!exists) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}
