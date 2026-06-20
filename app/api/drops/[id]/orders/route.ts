import type { NextRequest } from "next/server";
import { getCurrentSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Live order feed for the dashboard polling component. Auth: seller must own
// the drop. Returns placed (non-pending) orders, newest first.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const seller = await getCurrentSeller();
  if (!seller) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const drop = await prisma.drop.findUnique({
    where: { id },
    select: { sellerId: true },
  });
  if (!drop || drop.sellerId !== seller.id) {
    return new Response("Not found", { status: 404 });
  }

  const orders = await prisma.order.findMany({
    where: { dropId: id, status: { not: "pending" } },
    orderBy: { createdAt: "desc" },
    include: { items: { select: { id: true, name: true, quantity: true } } },
  });

  return Response.json({
    orders: orders.map((o) => ({
      id: o.id,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      buyerPhone: o.buyerPhone,
      note: o.note,
      status: o.status,
      paymentStatus: o.paymentStatus,
      source: o.source,
      totalCents: o.totalCents,
      createdAt: o.createdAt.toISOString(),
      items: o.items,
    })),
  });
}
