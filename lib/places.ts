import "server-only";

/**
 * Address autocomplete / geocoding abstraction.
 *
 * Current provider: OpenStreetMap Nominatim (free, no API key, same provider we
 * already use for geofence geocoding). Usage policy: identify via User-Agent and
 * keep volume low (the client debounces).
 *
 * TODO: to switch to Google Places, implement searchPlaces() against the Places
 * Autocomplete + Details APIs (set GOOGLE_MAPS_API_KEY) and keep this signature.
 */
export type PlaceResult = {
  formatted: string; // formatted_address
  name?: string; // place/business name if any
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`,
      { headers: { "User-Agent": "DropQ/1.0 (https://www.drop-q.com)" } }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      address?: Record<string, string>;
    }>;
    return (Array.isArray(data) ? data : [])
      .map((d) => {
        const a = d.address ?? {};
        return {
          formatted: d.display_name,
          name: a.amenity || a.shop || a.building || undefined,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon),
          city: a.city || a.town || a.village || a.hamlet,
          state: a.state,
          postalCode: a.postcode,
          country: a.country,
        };
      })
      .filter((r) => isFinite(r.lat) && isFinite(r.lng));
  } catch (e) {
    console.error("searchPlaces failed:", e);
    return [];
  }
}
