import { prisma } from "@/lib/db";
import { getCurrentAdmin } from "@/lib/auth";
import { commissionFilterWhere } from "@/lib/commission";

const HEADERS = [
  "commission_id", "created_at", "sales_rep", "sales_rep_email", "vendor",
  "order_id", "payment_id", "gross_order", "vendor_take", "dropq_fee",
  "commission_base", "commission_rate", "commission_amount", "status",
  "approved_at", "paid_at", "voided_at", "notes",
];

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const money = (cents: number | null | undefined) => ((cents ?? 0) / 100).toFixed(2);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

export async function GET(request: Request) {
  // Server-side access control — never trust the client.
  const admin = await getCurrentAdmin();
  if (!admin) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const g = (k: string) => url.searchParams.get(k) ?? undefined;
  const where = commissionFilterWhere({
    rep: g("rep"), vendor: g("vendor"), status: g("status"), from: g("from"), to: g("to"),
  });

  const rows = await prisma.commissionLedger.findMany({
    where,
    include: { vendor: { select: { storeName: true } }, salesRep: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const lines = [HEADERS.join(",")];
  for (const c of rows) {
    lines.push([
      c.id, iso(c.createdAt), c.salesRep.name, c.salesRep.email, c.vendor.storeName,
      c.orderId, c.paymentId ?? "", money(c.grossOrderAmount), money(c.vendorTakeAmount), money(c.dropqFeeAmount),
      money(c.commissionBaseAmount), c.commissionRate, money(c.commissionAmount), c.status,
      iso(c.approvedAt), iso(c.paidAt), iso(c.voidedAt), c.notes ?? "",
    ].map(csvCell).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dropq-commissions-${stamp}.csv"`,
    },
  });
}
