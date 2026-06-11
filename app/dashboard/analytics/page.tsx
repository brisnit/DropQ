import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { PageHeader, Stat, EmptyState, Section } from "@/components/dashboard-ui";

export const metadata = { title: "Analytics — DropQ" };

export default async function AnalyticsPage() {
  const seller = await requireSeller();

  const [orders, drops] = await Promise.all([
    prisma.order.findMany({
      where: { sellerId: seller.id, status: { not: "pending" } },
      include: { items: true },
    }),
    prisma.drop.findMany({
      where: { sellerId: seller.id },
      include: { orders: { select: { totalCents: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const revenue = orders.reduce((s, o) => s + o.totalCents, 0);
  const aov = orders.length ? Math.round(revenue / orders.length) : 0;
  const customers = new Set(orders.map((o) => o.buyerEmail)).size;

  // top products by units
  const prodMap = new Map<string, { name: string; units: number; revenue: number }>();
  for (const o of orders) {
    for (const it of o.items) {
      const cur = prodMap.get(it.name) ?? { name: it.name, units: 0, revenue: 0 };
      cur.units += it.quantity;
      cur.revenue += it.quantity * it.priceCents;
      prodMap.set(it.name, cur);
    }
  }
  const topProducts = [...prodMap.values()].sort((a, b) => b.units - a.units).slice(0, 6);
  const maxUnits = topProducts[0]?.units ?? 1;

  // revenue by drop
  const dropRows = drops
    .map((d) => ({ title: d.title, revenue: d.orders.reduce((s, o) => s + o.totalCents, 0) }))
    .filter((d) => d.revenue > 0);
  const maxDropRev = Math.max(1, ...dropRows.map((d) => d.revenue));

  if (orders.length === 0) {
    return (
      <Section>
        <PageHeader title="Analytics" subtitle="Numbers that tell you what to make more of." />
        <EmptyState
          emoji="📈"
          title="No data yet"
          body="Once you start selling, you'll see best-sellers, revenue per drop, and customer trends here."
          ctaHref="/dashboard/drops/new"
          ctaLabel="Create a drop"
        />
      </Section>
    );
  }

  return (
    <Section>
      <PageHeader title="Analytics" subtitle="Numbers that tell you what to make more of." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat label="Revenue" value={formatMoney(revenue)} sub="All time" />
        <Stat label="Orders" value={String(orders.length)} />
        <Stat label="Avg order" value={formatMoney(aov)} />
        <Stat label="Customers" value={String(customers)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top products */}
        <div className="bg-paper border border-line rounded-card p-6">
          <h2 className="font-semibold mb-4">Best sellers</h2>
          <div className="space-y-4">
            {topProducts.map((p) => (
              <div key={p.name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="truncate">{p.name}</span>
                  <span className="text-muted shrink-0 ml-2">
                    {p.units} sold · {formatMoney(p.revenue)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full"
                    style={{ width: `${Math.round((p.units / maxUnits) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue by drop */}
        <div className="bg-paper border border-line rounded-card p-6">
          <h2 className="font-semibold mb-4">Revenue by drop</h2>
          <div className="space-y-4">
            {dropRows.map((d) => (
              <div key={d.title}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="truncate">{d.title}</span>
                  <span className="text-muted shrink-0 ml-2">{formatMoney(d.revenue)}</span>
                </div>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <div
                    className="h-full bg-sage rounded-full"
                    style={{ width: `${Math.round((d.revenue / maxDropRev) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI teaser */}
      <div className="mt-6 rounded-card p-6 bg-ink text-cream flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-grey">Coming soon</span>
          <h3 className="font-display text-xl font-semibold mt-1">AI demand forecasting</h3>
          <p className="text-cream/70 mt-1 text-sm">
            DropQ will predict how much of each item to make next week based on your sell-out
            speed, waitlist size, and seasonality — so you bake to demand, not guesswork.
          </p>
        </div>
        <span className="text-4xl">🔮</span>
      </div>
    </Section>
  );
}
