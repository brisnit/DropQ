import "server-only";
import { Prisma } from "@/app/generated/prisma";
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
 * A unique-constraint violation is the ONE error that means "this row already
 * exists" — i.e. we already awarded or reversed this order and a retry landed.
 * Everything else (table missing, connection dropped, constraint we didn't
 * anticipate) is a real failure and must not be disguised as a duplicate.
 */
function isDuplicateRow(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Award points for a paid order. Idempotent via the unique (orderId, reason) —
 * a webhook retry or a double finalize cannot double-award.
 */
export async function awardPointsForOrder(orderId: string): Promise<number> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      sellerId: true,
      paymentStatus: true,
      items: { select: { priceCents: true, quantity: true } },
    },
  });
  if (!order?.customerId) return 0;
  if (order.paymentStatus !== "paid") return 0;

  // Earn on the goods themselves, summed from the order's own line items.
  //
  // Deriving this from `totalCents - feeCents` was wrong: totalCents only
  // includes the DropQ fee in "pass" mode (lib/actions/order.ts:84), so under
  // the default "absorb" mode subtracting feeCents quietly under-awards. A real
  // $5.00 absorb-mode order earned 4 points instead of 5. OrderItem also
  // snapshots price and quantity, so this stays accurate even if the product is
  // later edited or removed from the drop, and it can't drift if the seller
  // changes feeMode after the sale.
  const itemsCents = order.items.reduce((sum, it) => sum + it.priceCents * it.quantity, 0);
  const points = pointsForCents(itemsCents);
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
  } catch (e) {
    if (isDuplicateRow(e)) return 0; // already awarded — a retry, not a failure
    throw e; // real failure: let the caller log it rather than hide it
  }
}

/**
 * Reverse points when an order is refunded. Appends, never deletes.
 *
 * **This function never throws.** It runs inside the oversold-refund path, in
 * between issuing the Stripe refund and telling the customer their money is
 * coming back. An exception here used to escape all the way out of
 * `finalizePaidOrder`, skipping that SMS and email — and because the retry then
 * found the order already `refunded`, the message was never sent at all. The
 * buyer was silently refunded with no explanation. A loyalty-points problem is
 * never worth costing someone that notification, so failures are logged and
 * swallowed for reconciliation instead of propagating.
 */
export async function reversePointsForOrder(orderId: string, note?: string): Promise<void> {
  try {
    const earned = await prisma.pointsLedger.findUnique({
      where: { orderId_reason: { orderId, reason: "purchase" } },
    });
    if (!earned) return;

    await prisma.pointsLedger.create({
      data: {
        customerId: earned.customerId,
        sellerId: earned.sellerId,
        orderId,
        points: -earned.points,
        reason: "purchase_reversal",
        note: note ?? "order refunded",
      },
    });
  } catch (e) {
    if (isDuplicateRow(e)) return; // already reversed — a retry, not a failure
    console.error("reversePointsForOrder failed:", orderId, e);
  }
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
