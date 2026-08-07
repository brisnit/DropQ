import { NextResponse } from "next/server";
import { dropMeetFeed } from "@/lib/dropmeet/query";
import { isFilterKey, type FilterKey } from "@/lib/dropmeet/types";

/**
 * Bounds-filtered DropMeet feed, hit as the map pans.
 *
 * Public, but only ever returns approved in-region records — dropMeetFeed
 * applies both constraints in the query. The requested bounds are clamped to
 * the region server-side, so a hand-crafted bbox over Los Angeles returns
 * nothing rather than leaking out-of-region rows.
 */
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;

  const num = (k: string) => {
    const v = p.get(k);
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const minLat = num("minLat");
  const minLng = num("minLng");
  const maxLat = num("maxLat");
  const maxLng = num("maxLng");
  const bounds =
    minLat != null && minLng != null && maxLat != null && maxLng != null
      ? { minLat, minLng, maxLat, maxLng }
      : null;

  const filters = (p.get("filters") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isFilterKey) as FilterKey[];

  const { items } = await dropMeetFeed({
    bounds,
    q: p.get("q"),
    filters,
    limit: Math.min(Number(p.get("limit") ?? 200) || 200, 300),
  });

  return NextResponse.json({ items });
}
