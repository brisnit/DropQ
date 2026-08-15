/**
 * Repair purchase relationships recorded for orders that were never paid.
 *
 * Cause: until Phase E, `recordRelationship({ purchase })` fired at CHECKOUT
 * rather than on successful payment, so an abandoned Stripe session credited
 * the customer with a purchase they never made. Phase E moved the call into
 * `finalizePaidOrder`, so this can no longer happen — this script cleans up
 * what the old behaviour already wrote.
 *
 * DRY RUN BY DEFAULT.  node --env-file=.env prisma/repair-abandoned-purchase.mjs
 * To write:              ... prisma/repair-abandoned-purchase.mjs --commit
 *
 * What it changes, and nothing else:
 *   CustomerVendor : orderCount, totalSpentCents, firstPurchaseAt, lastPurchaseAt
 *   Customer       : firstPurchaseAt
 *
 * What it deliberately leaves alone:
 *   - the CustomerVendor ROW itself. The relationship is real — they reached
 *     this vendor's checkout. Only the purchase facts are false.
 *   - relationshipSource. Rewriting history is worse than an imprecise label.
 *   - the Order. A canceled/expired order is a truthful record.
 *   - signupSource / firstTouchAt / firstVendorId / followedAt — all correct.
 *
 * Idempotent: recomputes from paid orders, so a second run changes nothing.
 * Self-protecting: a customer who has ANY paid order is skipped entirely.
 */
import { PrismaClient } from "../app/generated/prisma/index.js";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");
/**
 * --only=<CustomerVendor id>  (repeatable). Without it the script reports every
 * drifted pair, which is the right default for auditing — but drift has more
 * than one cause and they are NOT all bugs. A dry run against production found:
 *
 *   1. an abandoned checkout          → a genuine bug, this script's purpose
 *   2. the Casa Makulay fulfilled/unpaid order → a real sale settled outside
 *      DropQ; whether it counts as a purchase is a PRODUCT decision
 *   3. a relationship whose order was deleted with its drop → orphaned facts,
 *      a third cause needing its own answer
 *
 * So writes are opt-in per row. Never blanket-commit this against production.
 */
const ONLY = process.argv.filter((a) => a.startsWith("--only=")).map((a) => a.slice(7));

const hash = (v) =>
  createHash("sha256")
    .update(JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x)))
    .digest("hex")
    .slice(0, 16);

console.log(COMMIT ? "MODE: COMMIT (writing)\n" : "MODE: DRY RUN (no writes)\n");

// Every relationship claiming purchases, checked against reality.
const rows = await prisma.customerVendor.findMany({
  where: { OR: [{ orderCount: { gt: 0 } }, { totalSpentCents: { gt: 0 } }, { firstPurchaseAt: { not: null } }] },
  include: { customer: { select: { id: true, email: true, firstPurchaseAt: true } } },
});

let fixedPairs = 0;
let fixedCustomers = 0;
const touchedCustomers = new Set();

for (const cv of rows) {
  const paid = await prisma.order.findMany({
    where: { customerId: cv.customerId, sellerId: cv.sellerId, paymentStatus: "paid" },
    select: { totalCents: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const truth = {
    orderCount: paid.length,
    totalSpentCents: paid.reduce((s, o) => s + o.totalCents, 0),
    firstPurchaseAt: paid[0]?.createdAt ?? null,
    lastPurchaseAt: paid.at(-1)?.createdAt ?? null,
  };

  const drift =
    cv.orderCount !== truth.orderCount ||
    cv.totalSpentCents !== truth.totalSpentCents ||
    (cv.firstPurchaseAt?.getTime() ?? null) !== (truth.firstPurchaseAt?.getTime() ?? null) ||
    (cv.lastPurchaseAt?.getTime() ?? null) !== (truth.lastPurchaseAt?.getTime() ?? null);

  if (!drift) continue;
  if (ONLY.length && !ONLY.includes(cv.id)) {
    console.log(`SKIP (not in --only)  ${cv.id}  ${cv.customer.email} — drift present, left alone`);
    continue;
  }

  console.log(`CustomerVendor ${cv.id}  (${cv.customer.email})`);
  console.log(`  before: orderCount=${cv.orderCount} totalSpentCents=${cv.totalSpentCents} ` +
    `firstPurchaseAt=${cv.firstPurchaseAt?.toISOString() ?? "null"}`);
  console.log(`  after:  orderCount=${truth.orderCount} totalSpentCents=${truth.totalSpentCents} ` +
    `firstPurchaseAt=${truth.firstPurchaseAt?.toISOString() ?? "null"}`);
  console.log(`  (their paid orders with this vendor: ${paid.length})`);

  if (COMMIT) await prisma.customerVendor.update({ where: { id: cv.id }, data: truth });
  fixedPairs++;
  touchedCustomers.add(cv.customerId);
}

// Platform-wide first purchase, recomputed across ALL vendors.
for (const customerId of touchedCustomers) {
  const first = await prisma.order.findFirst({
    where: { customerId, paymentStatus: "paid" },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { email: true, firstPurchaseAt: true },
  });
  const want = first?.createdAt ?? null;
  if ((c.firstPurchaseAt?.getTime() ?? null) === (want?.getTime() ?? null)) continue;

  console.log(`Customer ${c.email}`);
  console.log(`  firstPurchaseAt: ${c.firstPurchaseAt?.toISOString() ?? "null"} -> ${want?.toISOString() ?? "null"}`);
  if (COMMIT) await prisma.customer.update({ where: { id: customerId }, data: { firstPurchaseAt: want } });
  fixedCustomers++;
}

console.log(`\n${COMMIT ? "WROTE" : "WOULD WRITE"}: ${fixedPairs} CustomerVendor row(s), ${fixedCustomers} Customer row(s)`);

// Prove nothing else moved.
const [orders, orderItems, points, cvCount, customers] = await Promise.all([
  prisma.order.count(), prisma.orderItem.count(), prisma.pointsLedger.count(),
  prisma.customerVendor.count(), prisma.customer.count(),
]);
console.log(`counts: orders=${orders} orderItems=${orderItems} pointsLedger=${points} customerVendor=${cvCount} customers=${customers}`);
const all = await prisma.customerVendor.findMany({ orderBy: { id: "asc" } });
console.log("CustomerVendor content hash:", hash(all));

await prisma.$disconnect();
