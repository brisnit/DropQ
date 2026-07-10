import { NextResponse } from "next/server";
import { findDiscovery, DEFAULT_RADIUS_MILES, RADIUS_CHOICES } from "@/lib/discover";
import { geocode } from "@/lib/geofence";

// Public Vendor Finder endpoint. No auth. Returns only public-safe discovery
// data (see lib/discover.ts) — never private addresses, coordinates, customer,
// or payment data.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams;

  const num = (v: string | null) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  let lat = num(p.get("lat"));
  let lng = num(p.get("lng"));
  let label = p.get("label"); // display label for "Showing drops near …"

  // If no coordinates but a zip/city was given, geocode it server-side.
  const zip = (p.get("zip") || "").trim();
  const city = (p.get("city") || "").trim();
  const place = zip || city;
  if ((lat == null || lng == null) && place) {
    const geo = await geocode(zip ? `${zip}, USA` : place);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      label = label || place;
    } else {
      return NextResponse.json(
        { error: "not_found", message: "We couldn't find that location. Try a ZIP code or city.", items: [] },
        { status: 200 }
      );
    }
  }

  const radiusRaw = num(p.get("radius"));
  const radiusMiles =
    radiusRaw && (RADIUS_CHOICES as readonly number[]).includes(radiusRaw)
      ? radiusRaw
      : DEFAULT_RADIUS_MILES;

  const category = (p.get("category") || "").trim() || null;
  const when = (p.get("when") || "").trim() || null;

  const items = await findDiscovery({ lat, lng, radiusMiles, category, when });

  const res = NextResponse.json({
    location: { lat, lng, label: label || null, radiusMiles },
    count: items.length,
    items,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
