/**
 * One-time backfill: reconstruct vendor attribution from existing orders.
 *
 *   node --env-file=.env prisma/backfill-attribution.mjs
 *
 * What it derives, using order history as the only evidence we actually have:
 *   • Customer.firstVendorId / firstDropId / firstTouchAt / firstPurchaseAt
 *     from each customer's EARLIEST order — the closest thing to a first touch
 *     that exists retroactively. signupSource is set to "checkout" because
 *     that's literally how these customers arrived.
 *   • One CustomerVendor row per (customer, vendor) with real order counts,
 *     spend, and first/last purchase dates.
 *
 * `followedAt` is deliberately left null everywhere. Nobody in this dataset has
 * ever been shown a follow button, so recording a follow would be inventing
 * consent that was never given.
 *
 * Safe to re-run: existing attribution is never overwritten, and relationship
 * totals are recomputed from scratch rather than incremented.
 */

import { PrismaClient } from "../app/generated/prisma/index.js";

const prisma = new PrismaClient();

const PAID = ["new", "in_progress", "ready", "completed", "fulfilled"];

async function main() {
  const orders = await prisma.order.findMany({
    where: { customerId: { not: null }, status: { in: PAID } },
    orderBy: { createdAt: "asc" },
    select: {
      customerId: true,
      sellerId: true,
      dropId: true,
      totalCents: true,
      createdAt: true,
    },
  });

  if (orders.length === 0) {
    console.log("No attributable orders found. Run db:backfill-customers first.");
    return;
  }

  // (customer, vendor) → aggregate
  const pairs = new Map();
  // customer → earliest order
  const firstOrder = new Map();

  for (const o of orders) {
    const key = `${o.customerId}::${o.sellerId}`;
    const p = pairs.get(key);
    if (p) {
      p.orderCount++;
      p.totalSpentCents += o.totalCents;
      if (o.createdAt < p.firstPurchaseAt) p.firstPurchaseAt = o.createdAt;
      if (o.createdAt > p.lastPurchaseAt) p.lastPurchaseAt = o.createdAt;
    } else {
      pairs.set(key, {
        customerId: o.customerId,
        sellerId: o.sellerId,
        orderCount: 1,
        totalSpentCents: o.totalCents,
        firstPurchaseAt: o.createdAt,
        lastPurchaseAt: o.createdAt,
      });
    }

    // Orders are ascending, so the first one seen per customer is the earliest.
    if (!firstOrder.has(o.customerId)) firstOrder.set(o.customerId, o);
  }

  let attributed = 0;
  let skipped = 0;
  for (const [customerId, o] of firstOrder) {
    const c = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { firstVendorId: true, signupSource: true },
    });
    if (!c) continue;
    if (c.firstVendorId || c.signupSource) {
      skipped++;
      continue; // never overwrite an existing first touch
    }

    await prisma.customer.update({
      where: { id: customerId },
      data: {
        firstVendorId: o.sellerId,
        firstDropId: o.dropId,
        signupSource: "checkout",
        signupSourceDetail: "backfill:first_order",
        firstTouchAt: o.createdAt,
        firstPurchaseAt: o.createdAt,
      },
    });
    attributed++;
  }

  let created = 0;
  let updated = 0;
  for (const p of pairs.values()) {
    const existing = await prisma.customerVendor.findUnique({
      where: { customerId_sellerId: { customerId: p.customerId, sellerId: p.sellerId } },
    });
    const data = {
      orderCount: p.orderCount,
      totalSpentCents: p.totalSpentCents,
      firstPurchaseAt: p.firstPurchaseAt,
      lastPurchaseAt: p.lastPurchaseAt,
    };
    if (existing) {
      await prisma.customerVendor.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.customerVendor.create({
        data: {
          customerId: p.customerId,
          sellerId: p.sellerId,
          relationshipSource: "purchase",
          followedAt: null, // never invent a follow
          ...data,
        },
      });
      created++;
    }
  }

  // Cross-vendor customers are the whole point of the network model.
  const perCustomer = new Map();
  for (const p of pairs.values()) {
    perCustomer.set(p.customerId, (perCustomer.get(p.customerId) ?? 0) + 1);
  }
  const multi = [...perCustomer.values()].filter((n) => n > 1).length;

  console.log(`\n── Attribution backfill ──`);
  console.log(`Orders read         : ${orders.length}`);
  console.log(`Customers attributed: ${attributed} (${skipped} already had a first touch)`);
  console.log(`Relationships       : ${created} created, ${updated} updated`);
  console.log(`Cross-vendor buyers : ${multi}`);
  console.log(`\nfollowedAt left null everywhere — nobody has been offered a follow yet.`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
