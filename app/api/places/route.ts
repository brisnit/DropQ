import { NextResponse } from "next/server";
import { getCurrentSeller } from "@/lib/auth";
import { searchPlaces } from "@/lib/places";

// Address autocomplete for the seller drop form. Seller-only.
export async function GET(request: Request) {
  const seller = await getCurrentSeller();
  if (!seller) return NextResponse.json({ results: [] }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await searchPlaces(q);
  return NextResponse.json({ results });
}
