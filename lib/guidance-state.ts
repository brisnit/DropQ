import "server-only";
import { prisma } from "@/lib/db";
import type { ActivationFacts } from "@/lib/activation";
import {
  DEFAULT_GUIDANCE_STATE,
  TOUR_LENGTH,
  safeTourStep,
  type CoachmarkId,
  type GuidanceFacts,
  type GuidanceState,
  type TipId,
  type TourStatus,
} from "@/lib/guidance";

/**
 * Loading and persisting the stored half of vendor guidance.
 *
 * The split is deliberate and mirrors lib/activation.ts: every DECISION lives
 * in the pure, client-importable lib/guidance.ts; every QUERY and WRITE lives
 * here, behind `server-only`. A client component can hold a `GuidanceState`
 * but can never reach the code that loaded it.
 *
 * Nothing in this file decides anything. If you find yourself writing an `if`
 * about what a vendor should see, it belongs in lib/guidance.ts.
 */

/* --------------------------------- Reads --------------------------------- */

/**
 * This seller's guidance state, or the zero value if they have no row yet.
 *
 * Deliberately does NOT create the row. A read must stay a read: the dashboard
 * renders on every navigation, and an upsert there would turn a page view into
 * a write for every vendor on every request. The row is created by the first
 * action that actually has something to record.
 */
export async function loadGuidanceState(sellerId: string): Promise<GuidanceState> {
  const row = await prisma.vendorGuidance.findUnique({ where: { sellerId } });
  if (!row) return DEFAULT_GUIDANCE_STATE;
  return {
    welcomeSeenAt: row.welcomeSeenAt,
    // Whitelisted on read. The column is a plain string, so a bad value
    // written by a migration or a console session degrades to "not_started"
    // rather than putting the tour into a state no component handles.
    tourStatus: asTourStatus(row.tourStatus),
    tourStep: safeTourStep(row.tourStep),
    dismissedCoachmarks: row.dismissedCoachmarks,
    dismissedTips: row.dismissedTips,
    sharedAt: row.sharedAt,
    helpOpenedAt: row.helpOpenedAt,
  };
}

const TOUR_STATUSES: readonly TourStatus[] = [
  "not_started",
  "in_progress",
  "completed",
  "skipped",
];

function asTourStatus(v: string): TourStatus {
  return (TOUR_STATUSES as readonly string[]).includes(v) ? (v as TourStatus) : "not_started";
}

/**
 * The two counts `GuidanceFacts` adds on top of `activationFacts()`, plus the
 * two the tips need.
 *
 * `now` is injected so the "opens tomorrow" window is the caller's clock and
 * the whole thing stays deterministic in tests.
 *
 * Repeat customers are counted the way the Customers page groups them — by
 * `buyerEmail` on non-pending orders — rather than through `CustomerVendor`.
 * Those two disagree for orders that predate the customer backfill, and the
 * vendor-visible number is the one a tip must match: telling someone "people
 * are coming back" when their own Customers page shows no repeats would be a
 * bug they can see.
 */
export async function guidanceFacts(
  sellerId: string,
  activation: ActivationFacts,
  now: Date = new Date()
): Promise<GuidanceFacts> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [totalDrops, paidDropGroups, buyerGroups, dropsOpeningTomorrow] = await Promise.all([
    prisma.drop.count({ where: { sellerId } }),
    prisma.order.groupBy({
      by: ["dropId"],
      where: { sellerId, paymentStatus: "paid" },
    }),
    prisma.order.groupBy({
      by: ["buyerEmail"],
      where: { sellerId, status: { not: "pending" } },
      _count: true,
    }),
    prisma.drop.count({
      where: {
        sellerId,
        status: "live",
        mode: "preorder",
        opensAt: { gt: now, lte: tomorrow },
      },
    }),
  ]);

  return {
    ...activation,
    totalDrops,
    dropsWithPaidOrders: paidDropGroups.length,
    repeatCustomers: buyerGroups.filter((g) => g._count > 1).length,
    dropsOpeningTomorrow,
  };
}

/* --------------------------------- Writes -------------------------------- */

/**
 * Create-or-update, keyed on the seller. Every write goes through here so the
 * lazy row creation exists in exactly one place.
 */
async function upsert(
  sellerId: string,
  data: Parameters<typeof prisma.vendorGuidance.update>[0]["data"]
) {
  await prisma.vendorGuidance.upsert({
    where: { sellerId },
    create: { sellerId, ...(data as object) },
    update: data,
  });
}

/**
 * Stamped when the welcome modal is DISPLAYED, not when it is dismissed.
 *
 * That ordering is the whole guarantee: a vendor who closes the tab, loses
 * connection or navigates away mid-modal has still seen it, and showing it
 * again would be the "don't repeat yourself" failure. `updateMany` with a
 * null guard makes it write-once even if two tabs race.
 */
export async function markWelcomeSeen(sellerId: string): Promise<void> {
  const updated = await prisma.vendorGuidance.updateMany({
    where: { sellerId, welcomeSeenAt: null },
    data: { welcomeSeenAt: new Date() },
  });
  if (updated.count === 0) {
    // No row yet (the common case for a brand-new vendor). `create` can still
    // lose a race with another tab, so a duplicate is swallowed: the other
    // writer set the same field to within milliseconds of this one.
    await prisma.vendorGuidance
      .create({ data: { sellerId, welcomeSeenAt: new Date() } })
      .catch(() => {});
  }
}

export async function startTour(sellerId: string): Promise<void> {
  await upsert(sellerId, {
    tourStatus: "in_progress",
    tourStep: 0,
    tourStartedAt: new Date(),
    tourEndedAt: null,
    // Starting the tour implies the welcome has been dealt with. Stamping it
    // here means a vendor who lands directly on the tour (from Help) can never
    // be shown the welcome modal afterwards.
    welcomeSeenAt: new Date(),
  });
}

export async function setTourStep(sellerId: string, step: number): Promise<void> {
  await upsert(sellerId, { tourStatus: "in_progress", tourStep: safeTourStep(step) });
}

export async function endTour(
  sellerId: string,
  outcome: "completed" | "skipped",
  step: number
): Promise<void> {
  await upsert(sellerId, {
    tourStatus: outcome,
    tourStep: safeTourStep(step),
    tourEndedAt: new Date(),
    welcomeSeenAt: new Date(),
  });
}

export async function dismissCoachmark(sellerId: string, id: CoachmarkId): Promise<void> {
  const row = await prisma.vendorGuidance.findUnique({
    where: { sellerId },
    select: { dismissedCoachmarks: true },
  });
  if (row?.dismissedCoachmarks.includes(id)) return;
  await upsert(sellerId, { dismissedCoachmarks: [...(row?.dismissedCoachmarks ?? []), id] });
}

export async function dismissTip(sellerId: string, id: TipId): Promise<void> {
  const row = await prisma.vendorGuidance.findUnique({
    where: { sellerId },
    select: { dismissedTips: true },
  });
  if (row?.dismissedTips.includes(id)) return;
  await upsert(sellerId, { dismissedTips: [...(row?.dismissedTips ?? []), id] });
}

/**
 * First share only. Later shares are not interesting and rewriting the stamp
 * would destroy the one thing it answers: how long after publishing did they
 * tell anyone?
 */
export async function markShared(sellerId: string): Promise<void> {
  const updated = await prisma.vendorGuidance.updateMany({
    where: { sellerId, sharedAt: null },
    data: { sharedAt: new Date() },
  });
  if (updated.count === 0) {
    const existing = await prisma.vendorGuidance.findUnique({
      where: { sellerId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.vendorGuidance
        .create({ data: { sellerId, sharedAt: new Date() } })
        .catch(() => {});
    }
  }
}

export async function markHelpOpened(sellerId: string): Promise<void> {
  const updated = await prisma.vendorGuidance.updateMany({
    where: { sellerId, helpOpenedAt: null },
    data: { helpOpenedAt: new Date() },
  });
  if (updated.count === 0) {
    const existing = await prisma.vendorGuidance.findUnique({
      where: { sellerId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.vendorGuidance
        .create({ data: { sellerId, helpOpenedAt: new Date() } })
        .catch(() => {});
    }
  }
}

/** Exported for the self-test's source pin. */
export const GUIDANCE_TOUR_LENGTH = TOUR_LENGTH;
