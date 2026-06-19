import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney, relativeTime, formatDate } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";

const PAID = ["new", "ready", "fulfilled"];

export default async function AdminHome() {
  const [sellers, sales, customerGroups, liveDrops, subs] = await Promise.all([
    prisma.seller.findMany({
      include: { _count: { select: { drops: true, orders: true, subscribers: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.groupBy({
      by: ["sellerId"],
      where: { status: { in: PAID } },
      _sum: { totalCents: true, feeCents: true },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.order.groupBy({
      by: ["sellerId", "buyerEmail"],
      where: { status: { in: PAID } },
      _count: true,
    }),
    prisma.drop.findMany({ where: { status: "live" }, select: { sellerId: true }, distinct: ["sellerId"] }),
    prisma.subscriber.count(),
  ]);

  const salesMap = new Map(sales.map((s) => [s.sellerId, s]));
  const liveSet = new Set(liveDrops.map((d) => d.sellerId));
  const custCount = new Map<string, number>();
  for (const g of customerGroups) custCount.set(g.sellerId, (custCount.get(g.sellerId) ?? 0) + 1);

  const gmv = sales.reduce((s, x) => s + (x._sum.totalCents ?? 0), 0);
  const dropqRevenue = sales.reduce((s, x) => s + (x._sum.feeCents ?? 0), 0);
  const totalOrders = sales.reduce((s, x) => s + x._count, 0);
  const totalDrops = sellers.reduce((s, x) => s + x._count.drops, 0);

  function status(sellerId: string, orders: number) {
    if (liveSet.has(sellerId)) return { label: "Live drop", cls: "bg-sage-tint text-sage" };
    if (orders > 0) return { label: "Selling", cls: "bg-brand-tint text-brand-dark" };
    return { label: "New", cls: "bg-line text-ink-soft" };
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Clients</h1>
          <p className="text-muted mt-1">Every food business on DropQ.</p>
        </div>
      </div>

      {/* Platform totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Clients" value={String(sellers.length)} />
        <Stat label="GMV" value={formatMoney(gmv)} sub="Total sales" />
        <Stat label="DropQ revenue" value={formatMoney(dropqRevenue)} sub="Platform fees" />
        <Stat label="Orders" value={String(totalOrders)} sub={`${totalDrops} drops`} />
        <Stat label="Sign-ups" value={String(subs)} sub="Across all stores" />
      </div>

      {/* Clients table */}
      <div className="bg-paper border border-line rounded-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[2fr_1fr_0.7fr_0.7fr_1fr_1fr] gap-3 px-5 py-3 border-b border-line text-xs font-semibold uppercase tracking-wide text-muted">
          <span>Client</span>
          <span>Status</span>
          <span className="text-right">Drops</span>
          <span className="text-right">Orders</span>
          <span className="text-right">Sales</span>
          <span className="text-right">Last activity</span>
        </div>
        <div className="divide-y divide-line">
          {sellers.map((s) => {
            const sale = salesMap.get(s.id);
            const st = status(s.id, sale?._count ?? 0);
            const last = sale?._max.createdAt ?? s.createdAt;
            return (
              <Link
                key={s.id}
                href={`/admin/${s.id}`}
                className="grid grid-cols-2 md:grid-cols-[2fr_1fr_0.7fr_0.7fr_1fr_1fr] gap-2 md:gap-3 px-5 py-3.5 items-center hover:bg-cream/60 transition"
              >
                <div className="min-w-0 col-span-2 md:col-span-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{s.storeName}</span>
                    {s.isAdmin && <Badge className="bg-ink text-cream">admin</Badge>}
                  </div>
                  <p className="text-xs text-muted truncate">{s.email}</p>
                </div>
                <div><Badge className={st.cls}>{st.label}</Badge></div>
                <span className="text-sm text-right hidden md:block">{s._count.drops}</span>
                <span className="text-sm text-right hidden md:block">{sale?._count ?? 0}</span>
                <span className="text-sm font-semibold text-right">{formatMoney(sale?._sum.totalCents ?? 0)}</span>
                <span className="text-sm text-muted text-right hidden md:block">{relativeTime(last)}</span>
                <span className="text-xs text-muted md:hidden col-span-2">
                  {s._count.drops} drops · {custCount.get(s.id) ?? 0} customers · joined {formatDate(s.createdAt)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
