import { assertVerifyDatabase } from "../support/guard.mjs";
import { guidanceIds } from "./vendor.mjs";

/**
 * "Cedar & Salt" — the documentation vendor.
 *
 * Everything about this shop is invented. It exists so Help screenshots show
 * a real DropQ interface with plausible content, and so those screenshots are
 * byte-for-byte reproducible when the UI changes.
 *
 * ⚠️ SAFETY, in three layers:
 *   1. `assertVerifyDatabase()` runs before any PrismaClient is constructed, so
 *      this file cannot reach a database that is not the throwaway one.
 *   2. Every address is on example.com — reserved by RFC 2606, cannot reach a
 *      person — and every name is fictional.
 *   3. No Stripe identifier here is real. `stripeAccountId` is a made-up string
 *      that is never sent to Stripe; the screenshots show DropQ's own UI only.
 *
 * Deterministic by construction: dates are derived from a fixed anchor rather
 * than `Date.now()`, so a regenerated screenshot differs only when the UI does.
 */

export const DOCS_SLUG = "cedar-and-salt";
export const DOCS_EMAIL = "hello@cedar-and-salt.example.com";
export const DOCS_STORE = "Cedar & Salt";

const HOUR = 3600e3;
const DAY = 24 * HOUR;

/**
 * The clock the documentation vendor lives on: today, 9am Pacific.
 *
 * This was a FIXED date at first, so that images would be diffable between
 * runs. That turned out to be wrong, and the screenshots showed why. DropQ
 * derives a drop's phase from the real clock — "Scheduled", "Ordering open",
 * "Closed" — so a drop dated November while the machine says August renders as
 * "Scheduled" no matter what state we put it in. The live-drop screenshots
 * ended up saying "ordering hasn't opened yet" underneath two orders.
 *
 * A drop's phase has to be true, so the clock has to be real. The cost is that
 * the dates in the images move; the manifest records `generatedAt`, and every
 * scene sets its own dates relative to this, so each image is at least
 * internally consistent.
 */
export const DOCS_NOW = (() => {
  const d = new Date();
  d.setUTCHours(17, 0, 0, 0); // 9am PST / 10am PDT — a plausible working hour.
  return d;
})();

async function client(prismaModule, url) {
  assertVerifyDatabase(url);
  const { PrismaClient } = prismaModule;
  return new PrismaClient({ datasources: { db: { url } } });
}

async function wipe(db) {
  await db.vendorGuidance.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.product.deleteMany();
  await db.drop.deleteMany();
  await db.seller.deleteMany();
}

/** Base profile. Nothing here is a real business. */
function profile(termsVersion) {
  return {
    email: DOCS_EMAIL,
    passwordHash: "documentation-fixture-no-login",
    storeName: DOCS_STORE,
    slug: DOCS_SLUG,
    category: "food",
    tagline: "Sourdough, seeded crackers and slow ferments.",
    bio: "A two-person bakery working out of a shared kitchen. We bake Thursdays and hand over on Fridays.",
    location: "Portland, OR",
    emailVerified: true,
    termsAcceptedAt: DOCS_NOW,
    termsVersion,
    referralCode: "CEDARSALT",
    timezone: "America/Los_Angeles",
  };
}

/**
 * Guidance settled: welcome seen, tour finished, nothing outstanding.
 *
 * Documentation screenshots must show the PRODUCT, not the guidance layer
 * sitting on top of it — a welcome modal or a coachmark in a screenshot teaches
 * the wrong thing and dates the image the moment that copy changes.
 */
async function settleGuidance(db, sellerId) {
  const { coachmarks: COACHMARK_IDS, tips: TIP_IDS } = guidanceIds();
  await db.vendorGuidance.upsert({
    where: { sellerId },
    create: {
      sellerId,
      welcomeSeenAt: DOCS_NOW,
      tourStatus: "completed",
      dismissedCoachmarks: COACHMARK_IDS,
      dismissedTips: TIP_IDS,
    },
    update: {
      welcomeSeenAt: DOCS_NOW,
      tourStatus: "completed",
      dismissedCoachmarks: COACHMARK_IDS,
      dismissedTips: TIP_IDS,
    },
  });
}

/* ------------------------------- The scenes ------------------------------ */

/**
 * SCENE `new` — the vendor's first minutes. No Stripe, no drops.
 * Shows the activation checklist with everything ahead of them.
 */
export async function sceneNew(prismaModule, url, termsVersion) {
  const db = await client(prismaModule, url);
  try {
    await wipe(db);
    const seller = await db.seller.create({ data: profile(termsVersion) });
    await settleGuidance(db, seller.id);
    return seller;
  } finally {
    await db.$disconnect();
  }
}

/**
 * SCENE `draft` — Stripe connected, one drop built but not published.
 * This is where the editor, dates and inventory screenshots come from.
 */
export async function sceneDraft(prismaModule, url) {
  const db = await client(prismaModule, url);
  try {
    const seller = await db.seller.findFirstOrThrow({ where: { slug: DOCS_SLUG } });
    await db.seller.update({
      where: { id: seller.id },
      data: {
        // Fictional. Never sent to Stripe; only DropQ's own UI is captured.
        stripeAccountId: "acct_documentation_fixture",
        stripeChargesEnabled: true,
        stripeChargesEnabledAt: DOCS_NOW,
      },
    });
    const t = DOCS_NOW.getTime();
    const drop = await db.drop.create({
      data: {
        sellerId: seller.id,
        // No weekday in the name: the dates move with the clock (see
        // DOCS_NOW), and "Friday Bread Drop" collecting on a Tuesday is the
        // kind of small incoherence that makes a reader distrust the picture.
        title: "Sourdough & Rye Drop",
        description: "Country sourdough, seeded rye, and a small batch of cardamom buns.",
        status: "draft",
        mode: "preorder",
        fulfillment: "pickup",
        // Order Tue→Thu, collect Friday afternoon. Readable in a screenshot.
        opensAt: new Date(t + 1 * DAY),
        closesAt: new Date(t + 3 * DAY),
        pickupStartAt: new Date(t + 3 * DAY + 22 * HOUR),
        pickupEndAt: new Date(t + 4 * DAY),
        pickupLocationName: "The kitchen door",
        pickupAddress: "1400 SE Belmont St, Portland, OR",
        pickupFindMe: "Blue door on the side of the building — ring the bell.",
        pickupNotes: "Street parking is easiest on Belmont.",
        products: {
          create: [
            { name: "Country sourdough", description: "Naturally leavened, 1kg loaf.", priceCents: 900, inventory: 24, emoji: "🍞", sortOrder: 0 },
            { name: "Seeded rye", description: "Caraway, sunflower, flax.", priceCents: 1000, inventory: 12, emoji: "🌾", sortOrder: 1 },
            { name: "Cardamom bun", description: "Six to a bag.", priceCents: 1400, inventory: 8, emoji: "🥐", sortOrder: 2 },
          ],
        },
      },
    });
    return { seller, drop };
  } finally {
    await db.$disconnect();
  }
}

/**
 * SCENE `live` — the same drop published, shared, with a couple of orders.
 * Source of the publish, share, QR and orders screenshots.
 */
export async function sceneLive(prismaModule, url) {
  const db = await client(prismaModule, url);
  try {
    const seller = await db.seller.findFirstOrThrow({ where: { slug: DOCS_SLUG } });
    const drop = await db.drop.findFirstOrThrow({ where: { sellerId: seller.id } });
    const t = DOCS_NOW.getTime();
    await db.drop.update({
      where: { id: drop.id },
      data: {
        status: "live",
        // Shift the window back so ordering is OPEN at DOCS_NOW. The draft
        // scene deliberately shows a window that hasn't opened yet — that is
        // what a drop about to be published looks like — but a live drop with
        // orders on it and "ordering hasn't opened yet" on screen is a
        // contradiction, and the screenshots below are what teach a vendor
        // what live looks like.
        opensAt: new Date(t - 1 * DAY),
        closesAt: new Date(t + 2 * DAY),
        pickupStartAt: new Date(t + 2 * DAY + 22 * HOUR),
        pickupEndAt: new Date(t + 3 * DAY),
      },
    });

    // Two invented customers. Names are fictional; both addresses are on
    // example.com and cannot reach anyone.
    const orders = [
      { name: "Marlowe Finch", email: "marlowe@example.com", items: [["Country sourdough", 2, 900]], status: "new" },
      { name: "Ines Okafor", email: "ines@example.com", items: [["Seeded rye", 1, 1000], ["Cardamom bun", 1, 1400]], status: "ready" },
    ];
    for (const [i, o] of orders.entries()) {
      const total = o.items.reduce((n, [, q, p]) => n + q * p, 0);
      await db.order.create({
        data: {
          sellerId: seller.id, dropId: drop.id,
          buyerName: o.name, buyerEmail: o.email,
          status: o.status, paymentStatus: "paid",
          totalCents: total, feeCents: Math.round(total * 0.02),
          createdAt: new Date(DOCS_NOW.getTime() - (i + 1) * HOUR),
          items: { create: o.items.map(([name, quantity, priceCents]) => ({ name, quantity, priceCents })) },
        },
      });
    }
    for (const [name, sold] of [["Country sourdough", 2], ["Seeded rye", 1], ["Cardamom bun", 1]]) {
      await db.product.updateMany({ where: { dropId: drop.id, name }, data: { sold } });
    }
    return { seller, drop };
  } finally {
    await db.$disconnect();
  }
}

export async function openClient(prismaModule, url) {
  return client(prismaModule, url);
}
