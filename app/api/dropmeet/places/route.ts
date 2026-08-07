import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { activeRegion } from "@/lib/dropmeet/geo";
import { marketTypeLabel, locationTypeLabel } from "@/lib/dropmeet/types";

/**
 * Place picker for the vendor "Where I'll Be" flow.
 *
 * Vendor-only, and only ever returns *approved* places. That's the rule that
 * stops a vendor submitting a location and immediately appearing there before
 * anyone has reviewed it.
 */
export async function GET(request: Request) {
  await requireSeller();

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const region = await activeRegion();
  if (!region) return NextResponse.json({ results: [] });

  const like = { contains: q, mode: "insensitive" as const };

  const [markets, locations, events] = await Promise.all([
    prisma.market.findMany({
      where: { regionId: region.id, status: "approved", name: like },
      take: 8,
      include: {
        location: { select: { city: true, address: true } },
        schedules: { where: { active: true }, take: 1 },
      },
    }),
    prisma.location.findMany({
      where: { regionId: region.id, status: "approved", name: like },
      take: 8,
    }),
    prisma.event.findMany({
      where: {
        regionId: region.id,
        status: "approved",
        name: like,
        startDateTime: { gte: new Date() },
      },
      take: 6,
      orderBy: { startDateTime: "asc" },
    }),
  ]);

  const results = [
    ...markets.map((m) => ({
      id: m.id,
      kind: "market" as const,
      name: m.name,
      subtitle: [marketTypeLabel(m.marketType), m.location.city].filter(Boolean).join(" · "),
      defaultStart: m.schedules[0]?.startTime ?? null,
      defaultEnd: m.schedules[0]?.endTime ?? null,
    })),
    ...locations.map((l) => ({
      id: l.id,
      kind: "location" as const,
      name: l.name,
      subtitle: [locationTypeLabel(l.locationType), l.city].filter(Boolean).join(" · "),
      defaultStart: null,
      defaultEnd: null,
    })),
    ...events.map((e) => ({
      id: e.id,
      kind: "event" as const,
      name: e.name,
      subtitle: e.startDateTime.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "America/Los_Angeles",
      }),
      defaultStart: null,
      defaultEnd: null,
    })),
  ];

  return NextResponse.json({ results });
}
