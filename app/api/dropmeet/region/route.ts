import { NextResponse } from "next/server";
import { activeRegion } from "@/lib/dropmeet/geo";

/**
 * The active region's boundary, for the map to draw and mask against.
 *
 * Served separately from the page so ~50KB of polygon doesn't ride along in
 * every RSC payload. Caching is done with a Cache-Control header rather than
 * `revalidate` — the latter opts the route into static prerendering, which
 * would make `next build` reach for the database.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const region = await activeRegion();
  if (!region) return NextResponse.json({ error: "no_region" }, { status: 404 });

  return NextResponse.json(
    {
      slug: region.slug,
      name: region.name,
      center: region.center,
      zoom: region.zoom,
      bbox: region.bbox,
      geometry: region.rings ? { type: "Polygon", coordinates: region.rings } : null,
    },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } }
  );
}
