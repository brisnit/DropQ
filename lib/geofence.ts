import "server-only";
import { prisma } from "@/lib/db";

/**
 * Geocode a free-text location to coordinates using OpenStreetMap Nominatim
 * (free, no API key). Returns null on failure — callers should treat geocoding
 * as best-effort. Respects Nominatim usage policy (identifying User-Agent).
 */
export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "DropQ/1.0 (https://dropq.app)" } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/** Great-circle distance between two lat/lng points, in meters. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Placeholder geofencing service: given a location ping (from a future mobile
 * app), return the opted-in subscribers a seller could notify when a customer
 * is within the seller's geofence radius during a live drop.
 *
 * Wire this to native push once the mobile client exists — the data model and
 * eligibility rules (opt-in + radius + live drop) are already in place.
 */
export async function subscribersNearLocation(
  sellerId: string,
  lat: number,
  lng: number
) {
  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (
    !seller ||
    !seller.geofenceEnabled ||
    seller.latitude == null ||
    seller.longitude == null
  ) {
    return { eligible: false as const, reason: "geofencing-off", subscribers: [] };
  }

  const liveDrop = await prisma.drop.findFirst({ where: { sellerId, status: "live" } });
  if (!liveDrop) return { eligible: false as const, reason: "no-live-drop", subscribers: [] };

  const dist = distanceMeters(lat, lng, seller.latitude, seller.longitude);
  if (dist > seller.geofenceRadiusM) {
    return { eligible: false as const, reason: "out-of-range", subscribers: [] };
  }

  const subscribers = await prisma.subscriber.findMany({
    where: { sellerId, optInGeofence: true },
  });
  return { eligible: true as const, distance: dist, dropId: liveDrop.id, subscribers };
}
