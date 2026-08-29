import { assertVerifyDatabase } from "../support/guard.mjs";
import { readFileSync } from "node:fs";

/**
 * Deterministic fixture vendor for the browser suite.
 *
 * ⚠️ Every export here calls `assertVerifyDatabase()` first. This module
 * deletes sellers; it must be impossible to run it anywhere but the throwaway
 * verification database.
 *
 * Nothing in here is real. Names are invented, addresses are invented, and
 * every email is on `example.com`, which is reserved by RFC 2606 and can never
 * reach a person.
 */

export const VENDOR_SLUG = "sunday-bakehouse";
export const VENDOR_EMAIL = "vendor@example.com";

/** A clock the fixtures are built around, so relative dates read sensibly. */
const HOUR = 3600e3;
const DAY = 24 * HOUR;

async function client(prismaModule, url) {
  assertVerifyDatabase(url);
  const { PrismaClient } = prismaModule;
  return new PrismaClient({ datasources: { db: { url } } });
}

/** Wipe every fixture row. Scoped to this database by the guard above. */
async function wipe(db) {
  await db.vendorGuidance.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.product.deleteMany();
  await db.drop.deleteMany();
  await db.seller.deleteMany();
}

/**
 * A vendor who has just signed up: no Stripe, no drops, and deliberately NO
 * `VendorGuidance` row, so `welcomeSeenAt` is genuinely null and the welcome
 * modal has to appear on its own merits.
 */
export async function seedFresh(prismaModule, url, termsVersion) {
  const db = await client(prismaModule, url);
  try {
    await wipe(db);
    return await db.seller.create({
      data: {
        email: VENDOR_EMAIL,
        passwordHash: "not-a-real-hash",
        storeName: "Sunday Bakehouse",
        slug: VENDOR_SLUG,
        category: "food",
        emailVerified: false,
        termsAcceptedAt: new Date(),
        termsVersion,
        referralCode: "BROWSERTEST",
        timezone: "America/Los_Angeles",
      },
    });
  } finally {
    await db.$disconnect();
  }
}

/**
 * The same vendor, charge-ready, with one live drop and nothing shared yet —
 * the state just after a first publish.
 */
export async function seedSelling(prismaModule, url) {
  const db = await client(prismaModule, url);
  try {
    const seller = await db.seller.findFirstOrThrow({ where: { slug: VENDOR_SLUG } });
    await db.seller.update({
      where: { id: seller.id },
      data: {
        stripeAccountId: "acct_browser_test",
        stripeChargesEnabled: true,
        stripeChargesEnabledAt: new Date(),
      },
    });
    const now = Date.now();
    const drop = await db.drop.create({
      data: {
        sellerId: seller.id,
        title: "Friday Cookie Drop",
        description: "Brown butter week.",
        status: "live",
        mode: "preorder",
        fulfillment: "pickup",
        opensAt: new Date(now - HOUR),
        closesAt: new Date(now + 3 * DAY),
        pickupStartAt: new Date(now + 4 * DAY),
        pickupEndAt: new Date(now + 4 * DAY + 2 * HOUR),
        pickupLocationName: "The shop",
        products: {
          create: [
            { name: "Brown butter cookie", priceCents: 450, inventory: 24, emoji: "🍪", sortOrder: 0 },
            { name: "Cardamom bun", priceCents: 550, inventory: 12, emoji: "🥐", sortOrder: 1 },
          ],
        },
      },
    });
    await db.vendorGuidance.upsert({
      where: { sellerId: seller.id },
      create: { sellerId: seller.id, welcomeSeenAt: new Date(), tourStatus: "completed" },
      update: {
        welcomeSeenAt: new Date(),
        tourStatus: "completed",
        sharedAt: null,
        dismissedCoachmarks: [],
        dismissedTips: [],
      },
    });
    return { seller, drop };
  } finally {
    await db.$disconnect();
  }
}

/** Put the vendor past welcome + tour so contextual guidance is reachable. */
export async function settleGuidance(prismaModule, url, sellerId) {
  const db = await client(prismaModule, url);
  try {
    await db.vendorGuidance.upsert({
      where: { sellerId },
      create: { sellerId, welcomeSeenAt: new Date(), tourStatus: "completed" },
      update: {
        welcomeSeenAt: new Date(),
        tourStatus: "completed",
        dismissedCoachmarks: [],
        dismissedTips: [],
      },
    });
  } finally {
    await db.$disconnect();
  }
}

/**
 * The ids of every coachmark and tip that currently exists, read out of
 * lib/guidance.ts.
 *
 * Parsed from the source rather than hard-coded so that adding a coachmark
 * cannot silently start blocking clicks in tests that are not about guidance.
 */
export function guidanceIds() {
  const src = readFileSync("lib/guidance.ts", "utf8");
  const grab = (typeName) => {
    const block = src.split(`export type ${typeName} =`)[1]?.split(";")[0] ?? "";
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  return { coachmarks: grab("CoachmarkId"), tips: grab("TipId") };
}

/**
 * A vendor with nothing left to say to them: welcome seen, tour done, every
 * coachmark and tip dismissed.
 *
 * For tests about something else. A docked coachmark covers the bottom of the
 * viewport and intercepts clicks, so any spec that navigates the dashboard
 * without being about guidance needs this.
 */
export async function silenceGuidance(prismaModule, url, sellerId) {
  const { coachmarks, tips } = guidanceIds();
  const db = await client(prismaModule, url);
  try {
    const data = {
      welcomeSeenAt: new Date(),
      tourStatus: "completed",
      dismissedCoachmarks: coachmarks,
      dismissedTips: tips,
    };
    await db.vendorGuidance.upsert({ where: { sellerId }, create: { sellerId, ...data }, update: data });
  } finally {
    await db.$disconnect();
  }
}

/** Reset guidance entirely — a vendor who has never seen anything. */
export async function clearGuidance(prismaModule, url, sellerId) {
  const db = await client(prismaModule, url);
  try {
    await db.vendorGuidance.deleteMany({ where: { sellerId } });
  } finally {
    await db.$disconnect();
  }
}

export async function openClient(prismaModule, url) {
  return client(prismaModule, url);
}
