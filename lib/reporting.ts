import "server-only";
import type { Prisma } from "@/app/generated/prisma";

/**
 * One definition of "reportable business data".
 *
 * The problem this solves, verified against production: four of DropQ's eight
 * sellers are internal — founder, canary, staff, demo — and `app/admin/page.tsx`
 * counts all of them. Today's admin GMV, vendor count and order count include a
 * founder buying their own doughnut. Shipping an analytics dashboard on top of
 * that would mean building conversion rates out of our own clicks.
 *
 * THREE AUDIENCES, deliberately not one flag (docs/TEST-DATA-AND-METRICS.md §1):
 *
 *   business     — is DropQ working? EXCLUDES internal counterparties.
 *   operational  — what needs doing? EXCLUDES NOTHING. A test order still has
 *                  to be fulfilled and a canary vendor still needs support.
 *   financial    — did money move? EXCLUDES NOTHING. A real card charge on a
 *                  connected account is real money and real tax, whoever made
 *                  it. Suppressing it would break reconciliation.
 *
 * Only `business` filters. That asymmetry is the whole point: internal activity
 * is LABELLED, not hidden, so debugging and reconciliation stay honest.
 */

export type ReportingAudience = "business" | "operational" | "financial";

/* -------------------------------------------------------------------------- */
/*  Classification                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Every value `internalKind` may hold, and what it means.
 *
 * NULL means real external commerce. Anything non-null is DropQ-controlled.
 * Classification is set by hand by an admin, never inferred: guessing from a
 * name or a behaviour pattern would silently reclassify a real vendor whose
 * store happens to be called "Test Kitchen".
 */
export const INTERNAL_KINDS = ["founder", "canary", "staff", "demo", "docs", "harness"] as const;
export type InternalKind = (typeof INTERNAL_KINDS)[number];

export function isInternalKind(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

/* -------------------------------------------------------------------------- */
/*  Prisma filters                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Sellers that count as business.
 *
 * Also excludes suspended accounts from *acquisition* counting? No — it does
 * not, and that is intentional. A vendor who signed up and was later suspended
 * still converted; hiding them would flatter the funnel.
 */
export function sellerWhere(audience: ReportingAudience): Prisma.SellerWhereInput {
  return audience === "business" ? { internalKind: null } : {};
}

export function customerWhere(audience: ReportingAudience): Prisma.CustomerWhereInput {
  return audience === "business" ? { internalKind: null } : {};
}

/**
 * Orders that count as business.
 *
 * An order is internal if EITHER side is: a founder buying from a real vendor
 * is internal demand, and a real customer buying from the canary store is
 * internal supply. Both distort "is DropQ working?" and neither is fake money.
 */
export function orderWhere(audience: ReportingAudience): Prisma.OrderWhereInput {
  if (audience !== "business") return {};
  return {
    seller: { internalKind: null },
    OR: [{ customerId: null }, { customer: { internalKind: null } }],
  };
}

/**
 * Analytics events that count as business.
 *
 * Four independent contaminants, each excluded for a different reason:
 *   - `env` — only production traffic is business traffic.
 *   - `isBot` — crawlers are the majority of raw hits at this volume.
 *   - `isInternal` — stamped at write time from the seller/customer row.
 *   - harness traffic — the browser suite runs against a throwaway database,
 *     but the flag exists so that a mistake is visible rather than invisible.
 */
export function analyticsWhere(audience: ReportingAudience): Prisma.AnalyticsEventWhereInput {
  if (audience !== "business") return {};
  return { env: "production", isBot: false, isInternal: false };
}

/* -------------------------------------------------------------------------- */
/*  In-memory predicates                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The same rules for rows already loaded.
 *
 * Kept in step with the Prisma filters by the self-test, which asserts that a
 * hand-built row set filtered in memory matches what the query would return.
 */
export function isBusinessSeller(s: { internalKind: string | null }): boolean {
  return !isInternalKind(s.internalKind);
}

export function isBusinessCustomer(c: { internalKind: string | null }): boolean {
  return !isInternalKind(c.internalKind);
}

export function isBusinessOrder(o: {
  seller: { internalKind: string | null };
  customer?: { internalKind: string | null } | null;
}): boolean {
  if (!isBusinessSeller(o.seller)) return false;
  return !o.customer || isBusinessCustomer(o.customer);
}
