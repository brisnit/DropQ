import { NextResponse } from "next/server";
import { getCurrentSeller } from "@/lib/auth";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { searchPlaces } from "@/lib/places";

/**
 * Address autocomplete. Used by the vendor drop form and by the DropMeet
 * community "add a place" flow, so either signed-in principal may call it.
 * Still gated on *some* session — Nominatim's usage policy means this must not
 * be an open proxy.
 */
export async function GET(request: Request) {
  const [seller, customer] = await Promise.all([getCurrentSeller(), getCurrentCustomer()]);
  if (!seller && !customer) return NextResponse.json({ results: [] }, { status: 401 });

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const results = await searchPlaces(q);
  return NextResponse.json({ results });
}
