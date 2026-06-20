// Production-SAFE showcase seeder. Upserts ONLY the "marble-crumb" demo store
// (the homepage "See a live store" link). Never deletes other vendors.
// Run: node --env-file=.env prisma/seed-showcase.mjs
import prismaPkg from "../app/generated/prisma/index.js";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const { PrismaClient } = prismaPkg;
const prisma = new PrismaClient();

async function main() {
  const slug = "marble-crumb";
  const now = new Date();
  const partnerExpiresAt = new Date(now);
  partnerExpiresAt.setMonth(partnerExpiresAt.getMonth() + 12);

  const profile = {
    storeName: "Marble & Crumb",
    tagline: "Small-batch cookies & laminated pastry, baked Friday mornings.",
    bio: "A two-person home bakery in Austin. We drop a fresh menu every Friday and sell out most weeks. Cottage food permitted.",
    location: "Austin, TX",
    accent: "#7a5230",
    category: "food",
    logoUrl: "/demo/marble-crumb-logo.png",
    headerImageUrl: "/demo/marble-crumb-header.png",
    instagram: "https://instagram.com/marbleandcrumb",
    tiktok: "https://tiktok.com/@marbleandcrumb",
    facebook: "https://facebook.com/marbleandcrumb",
    website: "https://marbleandcrumb.example",
    emailVerified: true,
    termsAcceptedAt: now,
    termsVersion: "1.1",
    plan: "partner",
    partnerActivatedAt: now,
    partnerExpiresAt,
  };

  const passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);

  const seller = await prisma.seller.upsert({
    where: { slug },
    update: profile,
    create: { email: "showcase@dropq.example", passwordHash, slug, ...profile },
  });

  // Clean slate for this store only (keeps it idempotent).
  await prisma.drop.deleteMany({ where: { sellerId: seller.id } });
  await prisma.review.deleteMany({ where: { sellerId: seller.id } });
  await prisma.galleryImage.deleteMany({ where: { sellerId: seller.id } });

  await prisma.galleryImage.createMany({
    data: [
      { sellerId: seller.id, url: "/demo/marble-crumb-header.png", sortOrder: 0 },
      { sellerId: seller.id, url: "/demo/gallery-1.svg", sortOrder: 1 },
      { sellerId: seller.id, url: "/demo/gallery-2.svg", sortOrder: 2 },
      { sellerId: seller.id, url: "/demo/gallery-3.svg", sortOrder: 3 },
      { sellerId: seller.id, url: "/demo/gallery-4.svg", sortOrder: 4 },
    ],
  });

  await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title: "Friday Cookie Drop — Brown Butter Week",
      description:
        "This week is all about brown butter. Pickup Friday 4–6pm at the East Austin studio. Order by Thursday 9pm.",
      status: "live",
      mode: "preorder",
      fulfillment: "pickup",
      pickupInfo: "Fri 4–6pm · 2118 E Cesar Chavez, Austin",
      opensAt: new Date(now.getTime() - 1000 * 60 * 60 * 6),
      closesAt: new Date(now.getTime() + 1000 * 60 * 60 * 30),
      products: {
        create: [
          { name: "Brown Butter Chocolate Chunk (½ dozen)", description: "Sea salt, dark 70%, slightly underbaked centers.", priceCents: 1800, emoji: "🍪", inventory: 40, sold: 23, sortOrder: 0 },
          { name: "Miso Snickerdoodle (½ dozen)", description: "White miso + cinnamon sugar. Chewy, savory-sweet.", priceCents: 1600, emoji: "🟤", inventory: 30, sold: 19, sortOrder: 1 },
          { name: "Morning Bun (each)", description: "Laminated, orange sugar, made to order.", priceCents: 650, emoji: "🥐", inventory: 36, sold: 30, sortOrder: 2 },
          { name: "Cardamom Banana Bread (loaf)", description: "Brown butter glaze, walnuts.", priceCents: 1400, emoji: "🍌", inventory: 12, sold: 11, sortOrder: 3 },
        ],
      },
    },
  });

  await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title: "Valentine's Pre-Order Box",
      description: "A boxed set of six for the people you like.",
      status: "closed",
      mode: "preorder",
      fulfillment: "pickup",
      pickupInfo: "Feb 14, 12–3pm pickup",
      opensAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30),
      closesAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 28),
      products: { create: [{ name: "Sweetheart Box of 6", priceCents: 2400, emoji: "❤️", inventory: 60, sold: 60 }] },
    },
  });

  await prisma.review.createMany({
    data: [
      { sellerId: seller.id, authorName: "Jordan L.", serviceRating: 5, qualityRating: 5, comment: "Pickup was seamless and the brown butter cookies were unreal. Already ordered again." },
      { sellerId: seller.id, authorName: "Priya N.", serviceRating: 5, qualityRating: 4, comment: "Loved the morning buns. Sold out fast — set a reminder for next Friday!" },
      { sellerId: seller.id, authorName: "Devon B.", serviceRating: 4, qualityRating: 5, comment: "Best snickerdoodles in Austin. Texts kept me posted the whole way." },
    ],
  });

  console.log("✓ Showcase store ready (header + logo + reviews): /s/marble-crumb");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
