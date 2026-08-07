import "server-only";
import { prisma } from "@/lib/db";

/**
 * Server-side geographic validation for DropMeet.
 *
 * The region constraint is real containment, not a bounding box and not a map
 * viewport: every coordinate that enters the system is tested against the
 * authoritative county polygon (US Census TIGER) stored on the Region. A client
 * can lie about its map bounds; it cannot get a point past this.
 *
 * Why ray casting in TypeScript rather than PostGIS: Neon supports the
 * extension, but Prisma has no first-class geometry type, so using it would mean
 * raw SQL on every read and write path. A 1,300-vertex polygon tests in
 * microseconds, and the bbox pre-filter rejects most out-of-region points
 * without touching the polygon at all.
 */

export type LngLat = { lat: number; lng: number };

export type RegionGeo = {
  id: string;
  slug: string;
  name: string;
  rings: number[][][] | null; // GeoJSON coordinate rings, lng-first
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  center: LngLat;
  zoom: number;
};

/** Pull the GeoJSON rings out of a Polygon or MultiPolygon geometry. */
function ringsFromGeoJson(raw: string): number[][][] | null {
  try {
    const parsed = JSON.parse(raw);
    const geom =
      parsed?.type === "FeatureCollection"
        ? parsed.features?.[0]?.geometry
        : parsed?.type === "Feature"
          ? parsed.geometry
          : parsed;
    if (!geom) return null;
    if (geom.type === "Polygon") return geom.coordinates as number[][][];
    if (geom.type === "MultiPolygon") {
      // Flatten to a list of rings; each polygon's outer ring is what we test.
      return (geom.coordinates as number[][][][]).flat();
    }
    return null;
  } catch {
    return null;
  }
}

export function bboxOfRings(rings: number[][][]) {
  let minLat = 90;
  let minLng = 180;
  let maxLat = -90;
  let maxLng = -180;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}

/**
 * Even-odd ray casting. Counts crossings of a horizontal ray from the point;
 * odd means inside. Handles concave shapes and holes, which matters here —
 * San Diego County's coastline and its eastern edge are anything but convex.
 */
function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > lat !== yj > lat;
    if (!straddles) continue;
    // x-coordinate where edge (j→i) crosses the ray at height `lat`
    const crossX = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (lng < crossX) inside = !inside;
  }
  return inside;
}

export function pointInRings(lat: number, lng: number, rings: number[][][]): boolean {
  // Ring 0 of each polygon is the exterior; subsequent rings are holes. With a
  // flattened MultiPolygon we treat any odd containment count as inside, which
  // is correct for disjoint parts and for holes alike.
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(lat, lng, ring)) inside = !inside;
  }
  return inside;
}

export function inBbox(
  lat: number,
  lng: number,
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number }
): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

// Region lookups are hot and the boundary never changes at runtime, so cache
// the parsed rings per process rather than re-parsing 52KB of JSON per request.
const regionCache = new Map<string, RegionGeo>();

export async function loadRegion(slug: string): Promise<RegionGeo | null> {
  const cached = regionCache.get(slug);
  if (cached) return cached;

  const row = await prisma.region.findUnique({ where: { slug } });
  if (!row) return null;

  const rings = row.boundaryGeoJson ? ringsFromGeoJson(row.boundaryGeoJson) : null;
  const bbox =
    row.minLatitude != null &&
    row.minLongitude != null &&
    row.maxLatitude != null &&
    row.maxLongitude != null
      ? {
          minLat: row.minLatitude,
          minLng: row.minLongitude,
          maxLat: row.maxLatitude,
          maxLng: row.maxLongitude,
        }
      : rings
        ? bboxOfRings(rings)
        : null;

  const geo: RegionGeo = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    rings,
    bbox,
    center: { lat: row.defaultCenterLatitude, lng: row.defaultCenterLongitude },
    zoom: row.defaultZoom,
  };
  regionCache.set(slug, geo);
  return geo;
}

/** The single active launch region. */
export const DEFAULT_REGION_SLUG = "san-diego-county";

export async function activeRegion(): Promise<RegionGeo | null> {
  return loadRegion(DEFAULT_REGION_SLUG);
}

export type GeoCheck =
  | { ok: true; regionId: string }
  | { ok: false; reason: "no_region" | "outside_region" | "invalid_coordinates"; message: string };

/**
 * The gate every write path runs coordinates through. Callers must treat a
 * false result as fatal for the submission — there is no "warn and publish".
 */
export async function validateInRegion(
  lat: number,
  lng: number,
  regionSlug: string = DEFAULT_REGION_SLUG
): Promise<GeoCheck> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, reason: "invalid_coordinates", message: "Those coordinates aren't valid." };
  }

  const region = await loadRegion(regionSlug);
  if (!region) {
    return {
      ok: false,
      reason: "no_region",
      message: "DropMeet isn't switched on for any region yet.",
    };
  }

  // Cheap reject first.
  if (region.bbox && !inBbox(lat, lng, region.bbox)) {
    return {
      ok: false,
      reason: "outside_region",
      message: `That address is outside ${region.name}. DropMeet is ${region.name} only for now.`,
    };
  }

  // Then the real containment test. If we somehow have no polygon, the bbox is
  // the best we can do — but a region without a boundary is a seeding bug, so
  // say so loudly in the logs rather than silently loosening the rule.
  if (!region.rings) {
    console.warn(`Region ${region.slug} has no boundary polygon; fell back to bbox validation.`);
    return { ok: true, regionId: region.id };
  }

  if (!pointInRings(lat, lng, region.rings)) {
    return {
      ok: false,
      reason: "outside_region",
      message: `That address is outside ${region.name}. DropMeet is ${region.name} only for now.`,
    };
  }

  return { ok: true, regionId: region.id };
}

/**
 * Clamp a requested map viewport to the region. Belt-and-braces alongside the
 * map's own maxBounds — a bounds query is just a URL, so the server re-applies
 * the constraint before it ever reaches the database.
 */
export function clampBoundsToRegion(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  region: RegionGeo
) {
  if (!region.bbox) return bounds;
  return {
    minLat: Math.max(bounds.minLat, region.bbox.minLat),
    minLng: Math.max(bounds.minLng, region.bbox.minLng),
    maxLat: Math.min(bounds.maxLat, region.bbox.maxLat),
    maxLng: Math.min(bounds.maxLng, region.bbox.maxLng),
  };
}
