import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { createSalesRepAction } from "@/lib/actions/sales-reps";
import { statsForAllReps, globalCommissionSummary } from "@/lib/commission-stats";
import { formatMoney, formatDate } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge, Button, Input } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Sales Reps — DropQ Admin" };

function baseUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
}

export default async function SalesRepsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; deleted?: string; error?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const [reps, stats, summary] = await Promise.all([
    prisma.salesRep.findMany({ orderBy: { createdAt: "desc" } }),
    statsForAllReps(),
    globalCommissionSummary(),
  ]);
  const base = baseUrl();

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Sales Reps</h1>
        <p className="text-muted mt-1">
          Give each rep a referral code. Vendors who sign up with it are attributed to that rep,
          who earns commission on their sales.
        </p>
      </div>

      {sp.error && (
        <p className="mb-5 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">{sp.error.replace(/\+/g, " ")}</p>
      )}
      {sp.deleted && (
        <p className="mb-5 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">✓ Sales rep deleted.</p>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Active reps" value={String(summary.activeReps)} />
        <Stat label="Referred vendors" value={String(summary.referredVendors)} />
        <Stat label="Referred sales" value={formatMoney(summary.revenueFromReferredCents)} sub="Gross" />
        <Stat label="Unpaid commission" value={formatMoney(summary.unpaidCents)} />
        <Stat label="Paid commission" value={formatMoney(summary.paidCents)} />
      </div>

      {/* Create */}
      <form
        action={createSalesRepAction}
        className="bg-paper border border-line rounded-card p-5 mb-8 grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
      >
        <div className="lg:col-span-1">
          <label className="block text-xs font-medium text-muted mb-1">Name</label>
          <Input name="name" placeholder="James Rivera" required />
        </div>
        <div className="lg:col-span-1">
          <label className="block text-xs font-medium text-muted mb-1">Email</label>
          <Input name="email" type="email" placeholder="james@example.com" required />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Referral code (optional)</label>
          <Input name="referralCode" placeholder="Auto-generated" />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted mb-1">Commission %</label>
          <Input name="commissionPercent" type="number" step="0.1" min="0" defaultValue="1" />
        </div>
        <Button type="submit" variant="dark">Add sales rep</Button>
      </form>

      {/* Table */}
      {reps.length === 0 ? (
        <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center text-muted">
          No sales reps yet. Add your first one above.
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card bg-paper">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="px-4 py-3">Rep</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3 text-right">Vendors</th>
                <th className="px-4 py-3 text-right">Vendor sales</th>
                <th className="px-4 py-3 text-right">DropQ rev</th>
                <th className="px-4 py-3 text-right">Accrued</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Unpaid</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => {
                const s = stats.get(r.id);
                const link = `${base}/vendor/signup?ref=${r.referralCode}`;
                return (
                  <tr key={r.id} className="border-b border-line/60 hover:bg-cream/50">
                    <td className="px-4 py-3">
                      <Link href={`/admin/sales-reps/${r.id}`} className="font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                      <div className="text-xs text-muted">{r.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <code className="font-mono font-semibold bg-cream border border-line rounded px-1.5 py-0.5">{r.referralCode}</code>
                        <CopyButton text={link} label="Link" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">{s?.vendorCount ?? 0}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(s?.vendorSalesCents ?? 0)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(s?.dropqRevenueCents ?? 0)}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(s?.accruedCents ?? 0)}</td>
                    <td className="px-4 py-3 text-right text-muted">{formatMoney(s?.paidCents ?? 0)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(s?.unpaidCents ?? 0)}</td>
                    <td className="px-4 py-3">
                      <Badge className={r.status === "active" ? "bg-sage-tint text-sage" : "bg-line text-ink-soft"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/sales-reps/${r.id}`} className="text-brand font-medium hover:underline whitespace-nowrap">
                        Manage →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
