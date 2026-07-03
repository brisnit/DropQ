import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { commissionFilterWhere } from "@/lib/commission";
import { globalCommissionSummary } from "@/lib/commission-stats";
import { markCommissionPaidAction, voidCommissionAction } from "@/lib/actions/sales-reps";
import { formatMoney, formatDate } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";

export const metadata = { title: "Commissions — DropQ Admin" };

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-quad/15 text-ink-soft",
  approved: "bg-brand-tint text-brand-dark",
  paid: "bg-sage-tint text-sage",
  voided: "bg-line text-muted",
};

type SP = { rep?: string; vendor?: string; status?: string; from?: string; to?: string };

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const where = commissionFilterWhere(sp);

  const [summary, reps, vendors, rows, filteredAgg] = await Promise.all([
    globalCommissionSummary(),
    prisma.salesRep.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.seller.findMany({ where: { salesRepId: { not: null } }, orderBy: { storeName: "asc" }, select: { id: true, storeName: true } }),
    prisma.commissionLedger.findMany({
      where,
      include: { vendor: { select: { storeName: true } }, salesRep: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.commissionLedger.aggregate({ where, _sum: { commissionAmount: true }, _count: { _all: true } }),
  ]);

  const qs = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v).map(([k, v]) => [k, String(v)])
  ).toString();
  const back = `/admin/commissions${qs ? `?${qs}` : ""}`;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Commissions</h1>
        <p className="text-muted mt-1">All sales-rep commission activity across DropQ.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Active reps" value={String(summary.activeReps)} />
        <Stat label="Referred vendors" value={String(summary.referredVendors)} />
        <Stat label="Referred sales" value={formatMoney(summary.revenueFromReferredCents)} sub="Gross" />
        <Stat label="Unpaid commission" value={formatMoney(summary.unpaidCents)} />
        <Stat label="Paid commission" value={formatMoney(summary.paidCents)} />
      </div>

      {/* Filters */}
      <form method="get" className="bg-paper border border-line rounded-card p-4 mb-6 grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Sales rep</label>
          <select name="rep" defaultValue={sp.rep ?? ""} className="w-full bg-paper border border-line-strong rounded-xl px-3 py-2 text-sm">
            <option value="">All reps</option>
            {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Vendor</label>
          <select name="vendor" defaultValue={sp.vendor ?? ""} className="w-full bg-paper border border-line-strong rounded-xl px-3 py-2 text-sm">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.storeName}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Status</label>
          <select name="status" defaultValue={sp.status ?? ""} className="w-full bg-paper border border-line-strong rounded-xl px-3 py-2 text-sm">
            <option value="">All statuses</option>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="paid">paid</option>
            <option value="voided">voided</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">From</label>
          <input type="date" name="from" defaultValue={sp.from ?? ""} className="w-full bg-paper border border-line-strong rounded-xl px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">To</label>
          <input type="date" name="to" defaultValue={sp.to ?? ""} className="w-full bg-paper border border-line-strong rounded-xl px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="text-sm font-semibold bg-ink text-white px-3 py-2 rounded-lg hover:bg-ink-soft">Filter</button>
          <a href="/admin/commissions" className="text-sm font-medium px-3 py-2 rounded-lg border border-line-strong hover:border-ink/30">Clear</a>
        </div>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-sm text-muted">
          {filteredAgg._count._all} entr{filteredAgg._count._all === 1 ? "y" : "ies"} · total commission{" "}
          <span className="font-semibold text-ink">{formatMoney(filteredAgg._sum.commissionAmount ?? 0)}</span>
        </p>
        <a
          href={`/admin/commissions/export${qs ? `?${qs}` : ""}`}
          className="text-sm font-medium text-ink px-3 py-2 rounded-lg border border-line-strong bg-paper hover:border-ink/30"
        >
          Export CSV
        </a>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center text-muted">
          No commission entries match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card bg-paper">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Rep</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3 text-right">Order</th>
                <th className="px-4 py-3 text-right">Base</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3 text-right">Commission</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-line/60">
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(c.createdAt)}</td>
                  <td className="px-4 py-3">{c.salesRep.name}</td>
                  <td className="px-4 py-3">{c.vendor.storeName}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(c.grossOrderAmount)}</td>
                  <td className="px-4 py-3 text-right">{formatMoney(c.commissionBaseAmount)}</td>
                  <td className="px-4 py-3 text-right">{(c.commissionRate * 100).toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatMoney(c.commissionAmount)}</td>
                  <td className="px-4 py-3"><Badge className={STATUS_STYLE[c.status] ?? "bg-line"}>{c.status}</Badge></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {(c.status === "pending" || c.status === "approved") && (
                      <div className="flex items-center gap-2 justify-end">
                        <form action={markCommissionPaidAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="back" value={back} />
                          <button type="submit" className="text-brand font-medium hover:underline">Mark paid</button>
                        </form>
                        <form action={voidCommissionAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="back" value={back} />
                          <button type="submit" className="text-muted hover:text-ink">Void</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
