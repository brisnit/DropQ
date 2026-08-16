/**
 * Classify DropQ-controlled seller accounts (docs/TEST-DATA-AND-METRICS.md).
 *
 * `Seller.internalKind` NULL means real external commerce. Setting it marks the
 * account as ours, so business KPIs can exclude it — and every child row (Drop,
 * Order, WalkUpSale, PointsLedger, CustomerVendor) inherits by join, with no
 * per-row flag and no future backfill.
 *
 * ⚠️ CLASSIFICATION, NOT DESTRUCTION. Nothing is deleted or rewritten. A test
 * order still has to be fulfilled, and a real Stripe charge is still real money
 * on a real connected account — operational and financial views must keep
 * showing all of it.
 *
 * DRY RUN BY DEFAULT.  node --env-file=.env prisma/classify-internal-sellers.mjs
 * To write:            ... --commit
 *
 * Targets are matched by email, which is unique and stable. Reversible: clearing
 * the column returns an account to real commerce.
 */
import { PrismaClient } from "../app/generated/prisma/index.js";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();
const COMMIT = process.argv.includes("--commit");

/**
 * founder — a founder's own store; historical activity is largely testing
 * canary  — the designated production smoke-test vendor (features land here first)
 * staff   — an internal DropQ operations account
 * demo    — the public marketing showcase (already special-cased in lib/demo.ts)
 */
const TARGETS = [
  { email: "brisnit@gmail.com",        kind: "canary",  why: "primary production smoke-test vendor" },
  { email: "showcase@dropq.example",   kind: "demo",    why: "marketing showcase storefront" },
];

// Matched by store name where the email isn't a stable identifier for us.
const BY_STORE = [
  { storeName: "Casa Makulay", kind: "founder", why: "other founder's account; historical activity was testing" },
  { storeName: "DropQ Admin",  kind: "staff",   why: "internal operations account" },
];

const hash = (v) =>
  createHash("sha256")
    .update(JSON.stringify(v, (_k, x) => (x instanceof Date ? x.toISOString() : x)))
    .digest("hex").slice(0, 16);

console.log(COMMIT ? "MODE: COMMIT (writing)\n" : "MODE: DRY RUN (no writes)\n");

const plan = [];
for (const t of TARGETS) {
  const s = await prisma.seller.findUnique({
    where: { email: t.email },
    select: { id: true, storeName: true, email: true, internalKind: true },
  });
  if (!s) { console.log(`  ! no seller with email ${t.email} — skipped`); continue; }
  plan.push({ ...t, seller: s });
}
for (const t of BY_STORE) {
  const s = await prisma.seller.findFirst({
    where: { storeName: t.storeName },
    select: { id: true, storeName: true, email: true, internalKind: true },
  });
  if (!s) { console.log(`  ! no seller named ${t.storeName} — skipped`); continue; }
  if (plan.some((p) => p.seller.id === s.id)) continue;
  plan.push({ ...t, seller: s });
}

console.log("Sellers to classify:\n");
let changed = 0;
for (const p of plan) {
  const from = p.seller.internalKind ?? "null (real)";
  const same = p.seller.internalKind === p.kind;
  console.log(`  ${p.seller.storeName.padEnd(24)} ${p.seller.email.padEnd(28)}`);
  console.log(`     ${from}  ->  ${p.kind}${same ? "   (already set — no change)" : ""}`);
  console.log(`     reason: ${p.why}`);
  if (!same) {
    changed++;
    if (COMMIT) {
      await prisma.seller.update({ where: { id: p.seller.id }, data: { internalKind: p.kind } });
    }
  }
}

console.log(`\n${COMMIT ? "WROTE" : "WOULD WRITE"}: ${changed} seller row(s)`);

const all = await prisma.seller.findMany({
  select: { storeName: true, internalKind: true },
  orderBy: { storeName: "asc" },
});
console.log("\nResulting classification:");
for (const s of all) {
  console.log(`  ${s.storeName.padEnd(26)} ${s.internalKind ?? "— real commerce"}`);
}
console.log(`\n  real vendors: ${all.filter((s) => !s.internalKind).length} / ${all.length}`);

// Nothing else may move.
const [orders, items, points, cv, customers, drops] = await Promise.all([
  prisma.order.count(), prisma.orderItem.count(), prisma.pointsLedger.count(),
  prisma.customerVendor.count(), prisma.customer.count(), prisma.drop.count(),
]);
console.log(`counts: orders=${orders} orderItems=${items} pointsLedger=${points} customerVendor=${cv} customers=${customers} drops=${drops}`);
const sellers = await prisma.seller.findMany({ orderBy: { id: "asc" } });
console.log("Seller content hash:", hash(sellers));

await prisma.$disconnect();
