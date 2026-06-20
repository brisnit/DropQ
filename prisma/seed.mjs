// Optional: seed a read-only SHOWCASE storefront so the marketing site's
// "See a live store" link works. This is NOT a usable login — the account is
// created with a random password and is never advertised. Real users sign up
// at /signup to create their own store.
// Run: npm run db:seed   (or: node --env-file=.env prisma/seed.mjs)
import prismaPkg from "../app/generated/prisma/index.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function main() {
  console.log("Seeding DropQ showcase storefront…");

  // Clean slate (order matters for FK constraints)
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.drop.deleteMany();
  await prisma.seller.deleteMany();

  // Random, unguessable password — this showcase store cannot be logged into.
  const passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);

  const seller = await prisma.seller.create({
    data: {
      email: "showcase@dropq.example",
      passwordHash,
      storeName: "Marble & Crumb",
      slug: "marble-crumb",
      tagline: "Small-batch cookies & laminated pastry, baked Friday mornings.",
      bio: "A two-person home bakery in Austin. We drop a fresh menu every Friday and sell out most weeks. Cottage food permitted.",
      location: "Austin, TX",
      accent: "#cd1718",
    },
  });

  // LIVE drop — open for orders right now
  const liveDrop = await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title: "Friday Cookie Drop — Brown Butter Week",
      description:
        "This week is all about brown butter. Pickup Friday 4–6pm at the East Austin studio. Order by Thursday 9pm.",
      status: "live",
      fulfillment: "pickup",
      pickupInfo: "Fri 4–6pm · 2118 E Cesar Chavez, Austin",
      opensAt: new Date(Date.now() - 1000 * 60 * 60 * 6),
      closesAt: new Date(Date.now() + 1000 * 60 * 60 * 30),
      products: {
        create: [
          {
            name: "Brown Butter Chocolate Chunk (½ dozen)",
            description: "Sea salt, dark 70%, slightly underbaked centers.",
            priceCents: 1800,
            emoji: "🍪",
            inventory: 40,
            sold: 23,
            sortOrder: 0,
          },
          {
            name: "Miso Snickerdoodle (½ dozen)",
            description: "White miso + cinnamon sugar. Chewy, savory-sweet.",
            priceCents: 1600,
            emoji: "🟤",
            inventory: 30,
            sold: 19,
            sortOrder: 1,
          },
          {
            name: "Morning Bun (each)",
            description: "Laminated, orange sugar, made to order.",
            priceCents: 650,
            emoji: "🥐",
            inventory: 36,
            sold: 30,
            sortOrder: 2,
          },
          {
            name: "Cardamom Banana Bread (loaf)",
            description: "Brown butter glaze, walnuts.",
            priceCents: 1400,
            emoji: "🍌",
            inventory: 12,
            sold: 11,
            sortOrder: 3,
          },
        ],
      },
    },
    include: { products: true },
  });

  // CLOSED drop — history
  await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title: "Valentine's Pre-Order Box",
      description: "A boxed set of six for the people you like.",
      status: "closed",
      fulfillment: "pickup",
      pickupInfo: "Feb 14, 12–3pm pickup",
      opensAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      closesAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 28),
      products: {
        create: [
          {
            name: "Sweetheart Box of 6",
            priceCents: 2400,
            emoji: "❤️",
            inventory: 60,
            sold: 60,
          },
        ],
      },
    },
  });

  // A few orders against the live drop
  const p = liveDrop.products;
  const orderSpecs = [
    { name: "Jordan Lee", email: "jordan@example.com", phone: "512-555-0101", items: [[p[0], 1], [p[2], 2]] },
    { name: "Sam Rivera", email: "sam@example.com", phone: "512-555-0142", items: [[p[1], 1], [p[3], 1]] },
    { name: "Priya N.", email: "priya@example.com", phone: "512-555-0188", items: [[p[0], 2]] },
    { name: "Devon Brooks", email: "devon@example.com", phone: null, items: [[p[2], 3], [p[1], 1]] },
  ];

  for (let i = 0; i < orderSpecs.length; i++) {
    const spec = orderSpecs[i];
    const total = spec.items.reduce((s, [prod, qty]) => s + prod.priceCents * qty, 0);
    await prisma.order.create({
      data: {
        dropId: liveDrop.id,
        sellerId: seller.id,
        buyerName: spec.name,
        buyerEmail: spec.email,
        buyerPhone: spec.phone,
        totalCents: total,
        status: i === 0 ? "ready" : "new",
        createdAt: new Date(Date.now() - 1000 * 60 * (90 - i * 17)),
        items: {
          create: spec.items.map(([prod, qty]) => ({
            productId: prod.id,
            name: prod.name,
            priceCents: prod.priceCents,
            quantity: qty,
          })),
        },
      },
    });
  }

  console.log("✓ Showcase storefront ready (no login): /s/marble-crumb");
  console.log("→ Create your own account at /signup");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
