// Build a "Open in Maps" URL from an address or coordinates. Used everywhere we
// show a customer a pickup location — order screen, confirmation, emails, SMS.
// Prefers exact coordinates when we have them; otherwise geocodes the address
// via Google Maps' universal query URL (opens the user's default map app).

type MapsInput = {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export function createMapsUrl(input: MapsInput): string | null {
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${input.lat},${input.lng}`;
  }
  const addr = (input.address ?? "").trim();
  if (addr) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  }
  return null;
}

// Fields any drop carries for its pickup location.
type MapDrop = {
  pickupAddress?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupLocationName?: string | null;
  pickupInfo?: string | null;
};

/** Best maps URL for a drop's pickup location (coords → address → legacy line). */
export function dropMapsUrl(d: MapDrop): string | null {
  return createMapsUrl({
    address: d.pickupAddress || d.pickupLocationName || d.pickupInfo,
    lat: d.pickupLat,
    lng: d.pickupLng,
  });
}
