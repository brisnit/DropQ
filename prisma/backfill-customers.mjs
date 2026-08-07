/**
 * One-time backfill: give every historical order a Customer identity.
 *
 * Orders have always carried buyerEmail/buyerName/buyerPhone as loose strings;
 * messaging needs a durable Customer row to hang conversations off. This walks
 * existing orders, upserts one Customer per unique email (email is the identity
 * key, same as the Customers page has always used), and points the orders at it.
 *
 * Safe to re-run — it only touches orders whose customerId is still null.
 *
 *   node --env-file=.env prisma/backfill-customers.mjs
 */

import { PrismaClient } from "../app/generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  const orders = await prisma.order.findMany({
    where: { customerId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, buyerName: true, buyerEmail: true, buyerPhone: true },
  });

  if (orders.length === 0) {
    console.log("✓ Nothing to backfill — every order already has a customer.");
    return;
  }

  console.log(`Backfilling ${orders.length} order(s)…`);

  const cache = new Map();
  let created = 0;
  let linked = 0;

  for (const o of orders) {
    const email = o.buyerEmail?.trim().toLowerCase();
    if (!email) continue;

    let customerId = cache.get(email);
    if (!customerId) {
      const existing = await prisma.customer.findUnique({ where: { email } });
      if (existing) {
        customerId = existing.id;
        // Fill gaps without overwriting anything already known.
        const patch = {};
        if (!existing.name && o.buyerName) patch.name = o.buyerName;
        if (!existing.phone && o.buyerPhone) patch.phone = o.buyerPhone;
        if (Object.keys(patch).length > 0) {
          await prisma.customer.update({ where: { id: existing.id }, data: patch });
        }
      } else {
        const c = await prisma.customer.create({
          data: {
            email,
            name: o.buyerName?.trim() || null,
            phone: o.buyerPhone?.trim() || null,
          },
        });
        customerId = c.id;
        created++;
      }
      cache.set(email, customerId);
    }

    await prisma.order.update({ where: { id: o.id }, data: { customerId } });
    linked++;
  }

  console.log(`✓ Created ${created} customer(s); linked ${linked} order(s).`);
}

main()
  .catch((e) => {
    console.error("Backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
