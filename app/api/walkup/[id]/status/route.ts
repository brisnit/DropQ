import type { NextRequest } from "next/server";
import { getCurrentSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isWalkUpEnabled, walkUpMode, walkUpSaleState } from "@/lib/walkup";

/**
 * Vendor poll for a walk-up sale (Phase E). Seller-owned.
 *
 * ⚠️ `paid` is derived from `Order.paymentStatus`, which only
 * `finalizePaidOrder` sets. A customer merely returning from Stripe is NOT
 * paid — that distinction matters most in the oversell case, where the charge
 * succeeds and the order is then auto-canceled and refunded. The vendor must
 * never hand over goods on the strength of a redirect.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Cheap reject first: when the feature is off for everyone there is nothing
  // to look up. In "internal" mode eligibility depends on the seller, checked
  // below once we have them.
  if (walkUpMode() === "off") return new Response("Not found", { status: 404 });

  const seller = await getCurrentSeller();
  if (!seller) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const sale = await prisma.walkUpSale.findUnique({
    where: { id },
    select: {
      id: true, sellerId: true, orderId: true, canceledAt: true, expiresAt: true,
      order: { select: { id: true, status: true, paymentStatus: true, totalCents: true } },
    },
  });
  if (!sale || sale.sellerId !== seller.id) return new Response("Not found", { status: 404 });
  if (!isWalkUpEnabled(seller)) return new Response("Not found", { status: 404 });

  const base = walkUpSaleState(sale);
  let state:
    | "waiting" | "customer_paying" | "paid" | "refunded" | "expired" | "canceled" = "waiting";

  if (base === "canceled") state = "canceled";
  else if (base === "expired") state = "expired";
  else if (base === "converted" && sale.order) {
    const ps = sale.order.paymentStatus;
    state =
      ps === "paid" ? "paid"
      : ps === "refunded" || ps === "refund_pending" ? "refunded"
      : "customer_paying";
  }

  return Response.json({
    state,
    orderId: sale.order?.id ?? null,
    totalCents: sale.order?.totalCents ?? null,
    expiresAt: sale.expiresAt.toISOString(),
    // Terminal states stop the client polling.
    done: ["paid", "refunded", "expired", "canceled"].includes(state),
  });
}
