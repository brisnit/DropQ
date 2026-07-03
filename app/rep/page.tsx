import { prisma } from "@/lib/db";
import { requireRep } from "@/lib/rep-auth";
import { repLogoutAction } from "@/lib/actions/rep-auth";
import { statsForRep } from "@/lib/commission-stats";
import { formatMoney, formatDate } from "@/lib/format";
import { Logo } from "@/components/logo";
import { Stat } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Your Dashboard — DropQ Sales Rep" };

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-quad/15 text-ink-soft",
  approved: "bg-brand-tint text-brand-dark",
  paid: "bg-sage-tint text-sage",
  voided: "bg-line text-muted",
};

export default async function RepDashboard() {
  const rep = await requireRep(); // session-scoped — a rep only ever sees their own data

  const [stats, vendors, byVendor, recent] = await Promise.all([
    statsForRep(rep.id),
    prisma.seller.findMany({
      where: { salesRepId: rep.id },
      select: { id: true, storeName: true, referredAt: true, disabledAt: true },
      orderBy: { referredAt: "desc" },
    }),
    prisma.commissionLedger.groupBy({
      by: ["vendorId"],
      where: { salesRepId: rep.id, status: { not: "voided" } },
      _sum: { grossOrderAmount: true, commissionAmount: true },
    }),
    prisma.commissionLedger.findMany({
      where: { salesRepId: rep.id },
      include: { vendor: { select: { storeName: true } } },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
  ]);

  const salesByVendor = new Map(byVendor.map((v) => [v.vendorId, v._sum]));
  const base = process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
  const link = `${base}/vendor/signup?ref=${rep.referralCode}`;

  return (
    <div>
      <header className="border-b border-line bg-paper">
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="text-xs font-semibold uppercase tracking-wider bg-ink text-white px-2 py-0.5 rounded-pill">Sales Rep</span>
          </div>
          <form action={repLogoutAction}>
            <button type="submit" className="text-sm text-muted hover:text-ink">Log out</button>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-5 py-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Welcome, {rep.name}</h1>
        <p className="text-muted mt-1 max-w-2xl">
          You earn {(rep.commissionRate * 100).toFixed(rep.commissionRate * 100 % 1 ? 2 : 0)}% commission on eligible
          vendor sales from vendors who signed up using your referral code.
        </p>

        {/* Referral code + link */}
        <div className="bg-paper border border-line rounded-card p-5 mt-6 flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-muted mb-1">Your referral code</p>
            <code className="font-mono text-lg font-semibold bg-cream border border-line rounded px-2 py-1">{rep.referralCode}</code>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={rep.referralCode} label="Copy code" />
            <CopyButton text={link} label="Copy signup link" />
          </div>
          <p className="text-xs text-muted w-full break-all">{link}</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mt-6">
          <Stat label="Referred vendors" value={String(stats.vendorCount)} />
          <Stat label="Vendor sales" value={formatMoney(stats.vendorSalesCents)} />
          <Stat label="Accrued commission" value={formatMoney(stats.accruedCents)} />
          <Stat label="Paid" value={formatMoney(stats.paidCents)} />
          <Stat label="Unpaid balance" value={formatMoney(stats.unpaidCents)} />
        </div>

        {/* Referred vendors */}
        <h2 className="font-semibold text-lg mt-10 mb-3">Your referred vendors</h2>
        {vendors.length === 0 ? (
          <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted">
            No vendors yet. Share your signup link to start earning commission.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {vendors.map((v) => {
              const s = salesByVendor.get(v.id);
              return (
                <div key={v.id} className="bg-paper border border-line rounded-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium truncate">{v.storeName}</p>
                    <Badge className={v.disabledAt ? "bg-line text-muted" : "bg-sage-tint text-sage"}>
                      {v.disabledAt ? "inactive" : "active"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm mt-2 text-muted">
                    <span>Sales: <span className="text-ink font-medium">{formatMoney(s?.grossOrderAmount ?? 0)}</span></span>
                    <span>Commission: <span className="text-ink font-medium">{formatMoney(s?.commissionAmount ?? 0)}</span></span>
                  </div>
                  <p className="text-xs text-muted mt-1">Joined {v.referredAt ? formatDate(v.referredAt) : "—"}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Recent commission activity */}
        <h2 className="font-semibold text-lg mt-10 mb-3">Recent commission activity</h2>
        {recent.length === 0 ? (
          <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted">
            No commission activity yet.
          </div>
        ) : (
          <div className="overflow-x-auto border border-line rounded-card bg-paper">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id} className="border-b border-line/60">
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(c.createdAt)}</td>
                    <td className="px-4 py-3">{c.vendor.storeName}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(c.commissionAmount)}</td>
                    <td className="px-4 py-3"><Badge className={STATUS_STYLE[c.status] ?? "bg-line"}>{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted mt-8">
          Commission is calculated on eligible vendor sales and confirmed by DropQ before payout. Questions? Contact your DropQ admin.
        </p>
      </main>
    </div>
  );
}
