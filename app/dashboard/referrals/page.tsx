import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { salesRepForSeller } from "@/lib/sales-rep";
import { statsForRep } from "@/lib/commission-stats";
import { formatMoney, formatDate } from "@/lib/format";
import { Section } from "@/components/dashboard-ui";
import { Stat } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Referral Dashboard — DropQ" };

const PAID = ["new", "in_progress", "ready", "completed", "fulfilled"];

export default async function ReferralDashboard() {
  const seller = await requireSeller();
  // Server-side gate: only an ACTIVE sales rep linked to this account. A vendor
  // who isn't a rep is bounced; there are no id params to tamper with.
  const rep = await salesRepForSeller(seller);
  if (!rep) redirect("/dashboard");

  const vendors = await prisma.seller.findMany({
    where: { salesRepId: rep.id },
    select: {
      id: true, storeName: true, slug: true, referredAt: true, createdAt: true,
      disabledAt: true, subscriptionStatus: true, plan: true,
      _count: { select: { drops: true } },
    },
    orderBy: { referredAt: "desc" },
  });
  const vendorIds = vendors.map((v) => v.id);

  const [stats, byVendor, lastOrder, recentDrops, recentSales] = await Promise.all([
    statsForRep(rep.id),
    prisma.commissionLedger.groupBy({
      by: ["vendorId"],
      where: { salesRepId: rep.id, status: { not: "voided" } },
      _sum: { grossOrderAmount: true, commissionAmount: true },
    }),
    vendorIds.length
      ? prisma.order.groupBy({ by: ["sellerId"], where: { sellerId: { in: vendorIds } }, _max: { createdAt: true } })
      : Promise.resolve([] as { sellerId: string; _max: { createdAt: Date | null } }[]),
    vendorIds.length
      ? prisma.drop.findMany({ where: { sellerId: { in: vendorIds } }, orderBy: { createdAt: "desc" }, take: 8, include: { seller: { select: { storeName: true } } } })
      : Promise.resolve([]),
    vendorIds.length
      ? prisma.order.findMany({ where: { sellerId: { in: vendorIds }, status: { in: PAID } }, orderBy: { createdAt: "desc" }, take: 8, include: { seller: { select: { storeName: true } } } })
      : Promise.resolve([]),
  ]);

  const salesByVendor = new Map(byVendor.map((v) => [v.vendorId, v._sum]));
  const lastByVendor = new Map(lastOrder.map((o) => [o.sellerId, o._max.createdAt]));
  const activeSubscribed = vendors.filter((v) => v.subscriptionStatus === "active").length;

  const base = process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
  const link = `${base}/vendor/signup?ref=${rep.id}`;
  const pct = (rep.commissionRate * 100).toFixed((rep.commissionRate * 100) % 1 ? 2 : 0);

  return (
    <Section>
      <div className="mb-6">
        <span className="text-xs font-semibold uppercase tracking-wider bg-ink text-white px-2 py-0.5 rounded-pill">Sales Rep</span>
        <h1 className="font-display text-3xl font-semibold tracking-tight mt-2">Referral Dashboard</h1>
        <p className="text-muted mt-1 max-w-2xl">
          You earn {pct}% commission on eligible vendor sales from vendors who sign up using your link below.
        </p>
      </div>

      {/* Signup link */}
      <div className="bg-paper border border-line rounded-card p-5 mb-6 flex flex-wrap items-center gap-4">
        <div className="min-w-0">
          <p className="text-xs text-muted mb-1">Your vendor signup link</p>
          <p className="text-sm break-all">{link}</p>
        </div>
        <CopyButton text={link} label="Copy signup link" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
        <Stat label="Referred vendors" value={String(stats.vendorCount)} />
        <Stat label="Active subscribed" value={String(activeSubscribed)} />
        <Stat label="Vendor sales" value={formatMoney(stats.vendorSalesCents)} />
        <Stat label="Accrued" value={formatMoney(stats.accruedCents)} />
        <Stat label="Unpaid" value={formatMoney(stats.unpaidCents)} />
        <Stat label="Paid" value={formatMoney(stats.paidCents)} />
      </div>

      {/* Referred vendors */}
      <h2 className="font-semibold text-lg mb-3">Your referred vendors</h2>
      {vendors.length === 0 ? (
        <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted mb-8">
          No vendors yet. Share your signup link above to start earning commission.
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card bg-paper mb-8">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
              <tr>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Signed up</th>
                <th className="px-4 py-3">Subscription</th>
                <th className="px-4 py-3 text-right">Drops</th>
                <th className="px-4 py-3 text-right">Sales</th>
                <th className="px-4 py-3 text-right">Commission</th>
                <th className="px-4 py-3">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const s = salesByVendor.get(v.id);
                const last = lastByVendor.get(v.id);
                const subscribed = v.subscriptionStatus === "active";
                return (
                  <tr key={v.id} className="border-b border-line/60">
                    <td className="px-4 py-3 font-medium">{v.storeName}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(v.referredAt ?? v.createdAt)}</td>
                    <td className="px-4 py-3">
                      {v.disabledAt ? (
                        <Badge className="bg-line text-muted">inactive</Badge>
                      ) : subscribed ? (
                        <Badge className="bg-sage-tint text-sage">subscribed</Badge>
                      ) : (
                        <Badge className="bg-quad/15 text-ink-soft">{v.plan}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{v._count.drops}</td>
                    <td className="px-4 py-3 text-right">{formatMoney(s?.grossOrderAmount ?? 0)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatMoney(s?.commissionAmount ?? 0)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">{last ? formatDate(last) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-semibold text-lg mb-3">Recent drops</h2>
          {recentDrops.length === 0 ? (
            <p className="text-sm text-muted bg-paper border border-dashed border-line-strong rounded-card p-6 text-center">No drops yet.</p>
          ) : (
            <div className="space-y-2">
              {recentDrops.map((d) => (
                <div key={d.id} className="bg-paper border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.title}</p>
                    <p className="text-xs text-muted">{d.seller.storeName}</p>
                  </div>
                  <span className="text-xs text-muted whitespace-nowrap">{formatDate(d.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h2 className="font-semibold text-lg mb-3">Recent sales</h2>
          {recentSales.length === 0 ? (
            <p className="text-sm text-muted bg-paper border border-dashed border-line-strong rounded-card p-6 text-center">No sales yet.</p>
          ) : (
            <div className="space-y-2">
              {recentSales.map((o) => (
                <div key={o.id} className="bg-paper border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{o.seller.storeName}</p>
                    <p className="text-xs text-muted">{formatDate(o.createdAt)}</p>
                  </div>
                  <span className="font-semibold whitespace-nowrap">{formatMoney(o.totalCents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
