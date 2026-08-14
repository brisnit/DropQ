import "server-only";
import { prisma } from "@/lib/db";

/**
 * DropPoints — earning only.
 *
 * Earn rate: **$1 spent = 1 DropPoint**, rounded down. Points carry no dollar
 * value and cannot currently be redeemed; that is a deliberate product
 * decision, not an unfinished feature. Assigning a redemption value is a
 * pricing decision (see roadmap decision 3) and until it's made, showing a
 * customer a spendable-looking balance would be a promise DropQ hasn't decided
 * how to keep.
 *
 * Every purchase writes ONE row carrying both scopes: the sellerId is recorded
 * so vendor-specific redemption ("100 pts -> free item at The Clovery") can be
 * built later, while the DropQ-wide balance is just the sum across all rows.
 * No backfill needed either way.
 */

export const POINTS_PER_DOLLAR = 1;

export function pointsForCents(cents: number): number {
  return Math.floor((cents / 100) * POINTS_PER_DOLLAR);
}

/**
 * Award points for a paid order. Idempotent via the unique (orderId, reason) —
 * a webhook retry or a double finalize cannot double-award.
 */
export async function awardPointsForOrder(orderId: string): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true, sellerId: true, totalCents: true, feeCents: true, paymentStatus: true },
  });
  if (!order?.customerId) return 0;
  if (order.paymentStatus !== "paid") return 0;

  // Earn on what the customer actually paid for goods. In "pass" mode the
  // service fee is on top of the items, so it isn't spend with the vendor.
  const points = pointsForCents(order.totalCents - order.feeCents);
  if (points <= 0) return 0;

  try {
    await prisma.pointsLedger.create({
      data: {
        customerId: order.customerId,
        sellerId: order.sellerId,
        orderId: order.id,
        points,
        reason: "purchase",
      },
    });
    return points;
  } catch {
    // Unique violation = already awarded. Not an error.
    return 0;
  }
}

/** Reverse points when an order is refunded. Appends, never deletes. */
export async function reversePointsForOrder(orderId: string, note?: string): Promise<void> {
  const earned = await prisma.pointsLedger.findUnique({
    where: { orderId_reason: { orderId, reason: "purchase" } },
  });
  if (!earned) return;

  await prisma.pointsLedger
    .create({
      data: {
        customerId: earned.customerId,
        sellerId: earned.sellerId,
        orderId,
        points: -earned.points,
        reason: "purchase_reversal",
        note: note ?? "order refunded",
      },
    })
    .catch(() => {}); // already reversed
}

/** DropQ-wide balance. Derived from the ledger, never stored. */
export async function pointsBalance(customerId: string): Promise<number> {
  const agg = await prisma.pointsLedger.aggregate({
    where: { customerId },
    _sum: { points: true },
  });
  return agg._sum.points ?? 0;
}

/** Per-vendor balances, for future vendor-specific redemption. */
export async function pointsByVendor(customerId: string) {
  const rows = await prisma.pointsLedger.groupBy({
    by: ["sellerId"],
    where: { customerId, sellerId: { not: null } },
    _sum: { points: true },
  });
  const sellers = await prisma.seller.findMany({
    where: { id: { in: rows.map((r) => r.sellerId!).filter(Boolean) } },
    select: { id: true, slug: true, storeName: true, logoUrl: true },
  });
  const byId = new Map(sellers.map((s) => [s.id, s]));
  return rows
    .map((r) => ({ seller: byId.get(r.sellerId!), points: r._sum.points ?? 0 }))
    .filter((r) => r.seller && r.points > 0)
    .sort((a, b) => b.points - a.points);
}

/** Recent ledger entries for the customer-facing history. */
export async function pointsHistory(customerId: string, take = 25) {
  return prisma.pointsLedger.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take,
    include: { seller: { select: { storeName: true } } },
  });
}
