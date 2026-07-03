import "server-only";
import { prisma } from "@/lib/db";

export type RepStats = {
  vendorCount: number;
  vendorSalesCents: number; // gross from attributed (commissioned) orders
  dropqRevenueCents: number; // DropQ platform fee from those orders
  accruedCents: number; // all non-voided commission
  paidCents: number; // commission marked paid
  unpaidCents: number; // pending + approved
};

const ZERO: RepStats = {
  vendorCount: 0,
  vendorSalesCents: 0,
  dropqRevenueCents: 0,
  accruedCents: 0,
  paidCents: 0,
  unpaidCents: 0,
};

/** Commission + sales totals for a single sales rep. */
export async function statsForRep(salesRepId: string): Promise<RepStats> {
  const [vendorCount, live, paid, unpaid] = await Promise.all([
    prisma.seller.count({ where: { salesRepId } }),
    prisma.commissionLedger.aggregate({
      where: { salesRepId, status: { not: "voided" } },
      _sum: { grossOrderAmount: true, dropqFeeAmount: true, commissionAmount: true },
    }),
    prisma.commissionLedger.aggregate({
      where: { salesRepId, status: "paid" },
      _sum: { commissionAmount: true },
    }),
    prisma.commissionLedger.aggregate({
      where: { salesRepId, status: { in: ["pending", "approved"] } },
      _sum: { commissionAmount: true },
    }),
  ]);
  return {
    vendorCount,
    vendorSalesCents: live._sum.grossOrderAmount ?? 0,
    dropqRevenueCents: live._sum.dropqFeeAmount ?? 0,
    accruedCents: live._sum.commissionAmount ?? 0,
    paidCents: paid._sum.commissionAmount ?? 0,
    unpaidCents: unpaid._sum.commissionAmount ?? 0,
  };
}

/** Stats for every rep at once (for the admin list) keyed by rep id. */
export async function statsForAllReps(): Promise<Map<string, RepStats>> {
  const [vendors, live, paid, unpaid] = await Promise.all([
    prisma.seller.groupBy({ by: ["salesRepId"], where: { salesRepId: { not: null } }, _count: { _all: true } }),
    prisma.commissionLedger.groupBy({
      by: ["salesRepId"],
      where: { status: { not: "voided" } },
      _sum: { grossOrderAmount: true, dropqFeeAmount: true, commissionAmount: true },
    }),
    prisma.commissionLedger.groupBy({ by: ["salesRepId"], where: { status: "paid" }, _sum: { commissionAmount: true } }),
    prisma.commissionLedger.groupBy({
      by: ["salesRepId"],
      where: { status: { in: ["pending", "approved"] } },
      _sum: { commissionAmount: true },
    }),
  ]);

  const map = new Map<string, RepStats>();
  const get = (id: string) => map.get(id) ?? { ...ZERO };
  for (const v of vendors) if (v.salesRepId) { const s = get(v.salesRepId); s.vendorCount = v._count._all; map.set(v.salesRepId, s); }
  for (const r of live) { const s = get(r.salesRepId); s.vendorSalesCents = r._sum.grossOrderAmount ?? 0; s.dropqRevenueCents = r._sum.dropqFeeAmount ?? 0; s.accruedCents = r._sum.commissionAmount ?? 0; map.set(r.salesRepId, s); }
  for (const r of paid) { const s = get(r.salesRepId); s.paidCents = r._sum.commissionAmount ?? 0; map.set(r.salesRepId, s); }
  for (const r of unpaid) { const s = get(r.salesRepId); s.unpaidCents = r._sum.commissionAmount ?? 0; map.set(r.salesRepId, s); }
  return map;
}

/** Platform-wide commission summary for the admin dashboard cards. */
export async function globalCommissionSummary() {
  const [activeReps, referredVendors, revenue, paid, unpaid] = await Promise.all([
    prisma.salesRep.count({ where: { status: "active" } }),
    prisma.seller.count({ where: { salesRepId: { not: null } } }),
    prisma.commissionLedger.aggregate({ where: { status: { not: "voided" } }, _sum: { grossOrderAmount: true } }),
    prisma.commissionLedger.aggregate({ where: { status: "paid" }, _sum: { commissionAmount: true } }),
    prisma.commissionLedger.aggregate({ where: { status: { in: ["pending", "approved"] } }, _sum: { commissionAmount: true } }),
  ]);
  return {
    activeReps,
    referredVendors,
    revenueFromReferredCents: revenue._sum.grossOrderAmount ?? 0,
    paidCents: paid._sum.commissionAmount ?? 0,
    unpaidCents: unpaid._sum.commissionAmount ?? 0,
  };
}
