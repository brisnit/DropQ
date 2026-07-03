import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@/app/generated/prisma";

/** Build a Prisma where-clause for the admin commission dashboard filters. */
export function commissionFilterWhere(f: {
  rep?: string;
  vendor?: string;
  status?: string;
  from?: string;
  to?: string;
}): Prisma.CommissionLedgerWhereInput {
  const where: Prisma.CommissionLedgerWhereInput = {};
  if (f.rep) where.salesRepId = f.rep;
  if (f.vendor) where.vendorId = f.vendor;
  if (f.status && ["pending", "approved", "paid", "voided"].includes(f.status)) {
    where.status = f.status;
  }
  if (f.from || f.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (f.from) createdAt.gte = new Date(`${f.from}T00:00:00`);
    if (f.to) createdAt.lte = new Date(`${f.to}T23:59:59.999`);
    where.createdAt = createdAt;
  }
  return where;
}

/* ───────────────────────── Commission configuration ─────────────────────────
 * RATE: stored per sales rep (SalesRep.commissionRate, default 0.01 = 1%).
 *   • Change the default for NEW reps in prisma/schema.prisma (@default(0.01)).
 *   • Change an existing rep's rate from the admin Sales Rep edit page.
 *
 * BASE: the dollar amount the rate multiplies. Business rule = the vendor's take
 * (order total − DropQ's platform fee). To change the base (e.g. to the gross
 * order total, or to DropQ's own fee), edit `commissionBase()` below. Every
 * ledger row stores gross, vendor-take AND DropQ-fee, so reports can be
 * recomputed against a different base later without losing data.
 * ────────────────────────────────────────────────────────────────────────── */
export function commissionBase(grossCents: number, dropqFeeCents: number): number {
  // vendor take = gross − DropQ platform fee.   ⟵ CHANGE HERE to adjust the base
  return Math.max(0, grossCents - dropqFeeCents);
}

/** Normalize a referral code to a case-insensitive, URL-safe canonical form. */
export function normalizeCode(raw: string): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Generate a unique referral code, optionally seeded from the rep's name. */
export async function generateReferralCode(seed?: string): Promise<string> {
  const alpha = (normalizeCode(seed ?? "").slice(0, 6) || "REP").replace(/[0-9]+$/, "") || "REP";
  for (let i = 0; i < 60; i++) {
    const n = 10 + Math.floor(Math.random() * 990); // 2–3 digits
    const code = `${alpha}${n}`;
    const exists = await prisma.salesRep.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  return `REP${Date.now().toString(36).toUpperCase()}`;
}

type OrderForCommission = {
  id: string;
  sellerId: string;
  totalCents: number;
  feeCents: number;
  stripePaymentIntentId?: string | null;
};

/**
 * Create the commission ledger entry for a paid order, if the vendor is tied to
 * a sales rep. Idempotent: the unique (orderId, salesRepId) constraint means a
 * webhook retry / duplicate finalize can't create a second row.
 * Call this exactly once per order from the confirmed-paid path.
 */
export async function createCommissionForOrder(order: OrderForCommission): Promise<void> {
  const seller = await prisma.seller.findUnique({
    where: { id: order.sellerId },
    select: { salesRepId: true, salesRep: { select: { commissionRate: true } } },
  });
  if (!seller?.salesRepId || !seller.salesRep) return; // no attribution → no commission

  const rate = seller.salesRep.commissionRate ?? 0.01;
  const gross = order.totalCents;
  const fee = order.feeCents ?? 0;
  const base = commissionBase(gross, fee);
  const amount = Math.round(base * rate);

  try {
    await prisma.commissionLedger.create({
      data: {
        salesRepId: seller.salesRepId,
        vendorId: order.sellerId,
        orderId: order.id,
        paymentId: order.stripePaymentIntentId ?? null,
        grossOrderAmount: gross,
        vendorTakeAmount: base,
        dropqFeeAmount: fee,
        commissionBaseAmount: base,
        commissionRate: rate,
        commissionAmount: amount,
        status: "pending",
      },
    });
  } catch (e) {
    // Unique(orderId, salesRepId) violation = already recorded (retry). Swallow.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/unique/i.test(msg)) console.error("createCommissionForOrder failed:", e);
  }
}

/**
 * Void any not-yet-paid commission for an order (refund / cancellation). Paid
 * commissions are left intact (money already sent) — an admin can add a manual
 * negative adjustment if a clawback is needed.
 */
export async function voidCommissionForOrder(orderId: string, reason = "Order refunded/canceled"): Promise<void> {
  try {
    await prisma.commissionLedger.updateMany({
      where: { orderId, status: { in: ["pending", "approved"] } },
      data: { status: "voided", voidedAt: new Date(), notes: reason },
    });
  } catch (e) {
    console.error("voidCommissionForOrder failed:", e);
  }
}
