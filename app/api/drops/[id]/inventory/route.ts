import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isOrderingOpen } from "@/lib/drop-status";

// Live inventory for an open storefront tab. Lets a customer sitting on the
// page see items flip to "Sold out" without a manual refresh, so they can't
// try to add something that's already gone.
// NOTE: uses the [id] slug to match /api/drops/[id]/orders — Next requires a
// single slug name per dynamic path position.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const drop = await prisma.drop.findUnique({
    where: { id },
    select: {
      status: true,
      mode: true,
      opensAt: true,
      closesAt: true,
      products: { select: { id: true, inventory: true, sold: true } },
    },
  });
  if (!drop) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const res = NextResponse.json({
    open: isOrderingOpen(drop),
    products: drop.products.map((p) => ({
      id: p.id,
      remaining: Math.max(0, p.inventory - p.sold),
    })),
  });
  // Never cache — the whole point is fresh counts.
  res.headers.set("Cache-Control", "no-store");
  return res;
}
