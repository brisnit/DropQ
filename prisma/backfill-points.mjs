/**
 * One-off backfill: award DropPoints for orders that were paid before the
 * PointsLedger existed.
 *
 * PointsLedger shipped empty on 2026-08-14, so every order paid before that
 * earned nothing. This awards them at the corrected rate.
 *
 * SAFETY: dry run by default. Pass --commit to actually write.
 *   node --env-file=.env prisma/backfill-points.mjs            # plan only
 *   node --env-file=.env prisma/backfill-points.mjs --commit   # writes
 *
 * Touches PointsLedger ONLY. Order, Customer, Seller and OrderItem are read
 * and never modified.
 *
 * ── Why these rows use reason "purchase" and not "purchase_backfill" ────────
 *
 * An explicit backfill reason looks tidier but silently breaks two things,
 * because the uniqueness protection is on (orderId, reason) — so a different
 * reason is a DIFFERENT row, not a conflicting one:
 *
 *   1. Refunds would stop reversing. reversePointsForOrder() looks up exactly
 *      { orderId, reason: "purchase" } (lib/rewards.ts). A backfilled order
 *      refunded later would keep its points forever.
 *   2. Double-awarding becomes possible. awardPointsForOrder() writes
 *      reason: "purchase". Against a "purchase_backfill" row that insert does
 *      NOT collide, so the order could be awarded twice.
 *
 * So the reason stays "purchase" — that is what makes these rows behave like
 * every other award — and provenance is carried in `note` instead, which is
 * both queryable (note IS NOT NULL) and reads honestly to the customer, who
 * sees it in their history on /my/rewards.
 */

import { PrismaClient } from "../app/generated/prisma/index.js";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

// When PointsLedger went live (migration 20260814162909_add_points_ledger).
// Orders paid before this could never have earned points in real time.
const LEDGER_LIVE_AT = new Date("2026-08-14T16:29:09-07:00");
const HISTORICAL_NOTE = "Earned before DropPoints launched";

function pointsForCents(cents) {
  return Math.floor(cents / 100); // $1 = 1 point, rounded down
}

async function main() {
  // Only orders with a CONFIRMED paid status. This is what excludes the
  // fulfilled-but-unpaid Casa Makulay order: points follow recorded payment,
  // never fulfilment.
  const orders = await prisma.order.findMany({
    where: { paymentStatus: "paid", customerId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      customerId: true,
      sellerId: true,
      buyerName: true,
      seller: { select: { storeName: true } },
      items: { select: { priceCents: true, quantity: true } },
    },
  });

  // Skip anything already awarded, so this is a no-op on a second run even
  // before the database's own uniqueness protection is reached.
  const existing = new Set(
    (
      await prisma.pointsLedger.findMany({
        where: { reason: "purchase", orderId: { in: orders.map((o) => o.id) } },
        select: { orderId: true },
      })
    ).map((r) => r.orderId)
  );

  const rows = [];
  const skipped = [];

  for (const o of orders) {
    // The corrected calculation: sum the order's own line items. NOT
    // totalCents - feeCents, which only holds in "pass" fee mode.
    const itemsCents = o.items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
    const points = pointsForCents(itemsCents);

    if (existing.has(o.id)) {
      skipped.push({ o, points, why: "already has a purchase row" });
      continue;
    }
    if (points <= 0) {
      skipped.push({ o, points, why: "rounds to 0 points" });
      continue;
    }

    rows.push({
      customerId: o.customerId,
      sellerId: o.sellerId,
      orderId: o.id,
      points,
      reason: "purchase",
      // Only orders that predate the ledger get the historical note. A recent
      // order landing here means its real-time award failed and this is a
      // repair, not a backfill — so it should look like a normal award.
      note: o.createdAt < LEDGER_LIVE_AT ? HISTORICAL_NOTE : null,
    });
  }

  const total = rows.reduce((s, r) => s + r.points, 0);

  console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — backfill DropPoints\n`);
  for (const r of rows) {
    const o = orders.find((x) => x.id === r.orderId);
    console.log(
      `  +${String(r.points).padStart(3)}  ${o.createdAt.toISOString().slice(0, 10)}  ` +
        `${o.seller.storeName.padEnd(20)} ${o.buyerName.padEnd(24)} ${r.orderId}`
    );
  }
  for (const s of skipped) {
    console.log(`  skip   ${s.o.id}  (${s.why})`);
  }
  console.log(
    `\n  ${rows.length} rows, ${total} points, ` +
      `${new Set(rows.map((r) => r.customerId)).size} customers, ` +
      `${new Set(rows.map((r) => r.sellerId)).size} vendors`
  );

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to apply.");
    return;
  }
  if (rows.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  // All-or-nothing. skipDuplicates turns the unique (orderId, reason) index
  // into ON CONFLICT DO NOTHING, so a concurrent real-time award racing this
  // backfill loses harmlessly instead of erroring or double-awarding.
  const result = await prisma.$transaction(async (tx) =>
    tx.pointsLedger.createMany({ data: rows, skipDuplicates: true })
  );

  console.log(`\nInserted ${result.count} rows (${rows.length - result.count} already existed).`);

  const sum = await prisma.pointsLedger.aggregate({ _sum: { points: true } });
  console.log(`PointsLedger now totals ${sum._sum.points ?? 0} points.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
