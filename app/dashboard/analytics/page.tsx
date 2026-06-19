import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { PageHeader, Stat, EmptyState, Section } from "@/components/dashboard-ui";

export const metadata = { title: "Analytics — DropQ" };

const PAID = ["new", "ready", "fulfilled"];

function quarterKey(d: Date) {
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export default async function AnalyticsPage() {
  const seller = await requireSeller();

  const [orders, drops, signupCount] = await Promise.all([
    prisma.order.findMany({
      where: { sellerId: seller.id, status: { in: PAID } },
      include: { items: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.drop.findMany({
      where: { sellerId: seller.id },
      include: { orders: { where: { status: { in: PAID } }, select: { totalCents: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.subscriber.count({ where: { sellerId: seller.id } }),
  ]);

  if (orders.length === 0) {
    return (
      <Section>
        <PageHeader title="Analytics" subtitle="Numbers that tell you what to make more of." />
        <EmptyState
          emoji="📈"
          title="No data yet"
          body="Once you start selling, you'll see quarterly sales, best-sellers, top customers, and repeat behavior here."
          ctaHref="/dashboard/drops/new"
          ctaLabel="Create a drop"
        />
      </Section>
    );
  }

  const revenue = orders.reduce((s, o) => s + o.totalCents, 0);
  const fees = orders.reduce((s, o) => s + o.feeCents, 0);
  const net = revenue - fees;
  const aov = Math.round(revenue / orders.length);

  // Customers
  const byCustomer = new Map<string, { name: string; orders: number; spent: number }>();
  for (const o of orders) {
    const c = byCustomer.get(o.buyerEmail) ?? { name: o.buyerName, orders: 0, spent: 0 };
    c.orders += 1;
    c.spent += o.totalCents;
    byCustomer.set(o.buyerEmail, c);
  }
  const customers = [...byCustomer.entries()];
  const repeat = customers.filter(([, c]) => c.orders > 1).length;
  const repeatRate = Math.round((repeat / customers.length) * 100);
  const avgOrders = (orders.length / customers.length).toFixed(1);
  const topCustomers = customers.sort((a, b) => b[1].spent - a[1].spent).slice(0, 6);

  // Quarterly
  const byQuarter = new Map<string, { orders: number; sales: number; fees: number }>();
  for (const o of orders) {
    const k = quarterKey(o.createdAt);
    const q = byQuarter.get(k) ?? { orders: 0, sales: 0, fees: 0 };
    q.orders += 1;
    q.sales += o.totalCents;
    q.fees += o.feeCents;
    byQuarter.set(k, q);
  }
  const quarters = [...byQuarter.entries()].slice(-6);
  const maxQ = Math.max(1, ...quarters.map(([, q]) => q.sales));

  // Products
  const byProduct = new Map<string, { units: number; revenue: number }>();
  for (const o of orders)
    for (const it of o.items) {
      const p = byProduct.get(it.name) ?? { units: 0, revenue: 0 };
      p.units += it.quantity;
      p.revenue += it.quantity * it.priceCents;
      byProduct.set(it.name, p);
    }
  const topProducts = [...byProduct.entries()].sort((a, b) => b[1].units - a[1].units).slice(0, 6);
  const maxUnits = topProducts[0]?.[1].units ?? 1;

  // Drops
  const dropRows = drops
    .map((d) => ({ title: d.title, orders: d.orders.length, revenue: d.orders.reduce((s, o) => s + o.totalCents, 0) }))
    .filter((d) => d.orders > 0);
  const maxDropRev = Math.max(1, ...dropRows.map((d) => d.revenue));

  return (
    <Section>
      <PageHeader
        title="Analytics"
        subtitle="Numbers that tell you what to make more of."
        action={
          <a
            href="/api/export/orders"
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            ↓ Export CSV
          </a>
        }
      />

      {/* Totals */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Sales" value={formatMoney(revenue)} sub="Gross, all time" />
        <Stat label="Your earnings" value={formatMoney(net)} sub={`after ${formatMoney(fees)} DropQ fees`} />
        <Stat label="Orders" value={String(orders.length)} sub={`avg ${formatMoney(aov)}`} />
        <Stat label="Customers" value={String(customers.length)} sub={`${repeatRate}% repeat`} />
        <Stat label="Sign-ups" value={String(signupCount)} sub="Future-drop list" />
      </div>

      {/* Quarterly */}
      <div className="bg-paper border border-line rounded-card p-6 mb-6">
        <h2 className="font-semibold mb-4">Quarterly sales</h2>
        <div className="space-y-3">
          {quarters.map(([k, q]) => (
            <div key={k}>
              <div className="flex justify-between text-sm mb-1.5">
                <span className="font-medium">{k}</span>
                <span className="text-muted">{q.orders} orders · {formatMoney(q.sales)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-line overflow-hidden">
                <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round((q.sales / maxQ) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Best sellers */}
        <div className="bg-paper border border-line rounded-card p-6">
          <h2 className="font-semibold mb-4">Best sellers</h2>
          <div className="space-y-4">
            {topProducts.map(([name, p]) => (
              <div key={name}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="truncate">{name}</span>
                  <span className="text-muted shrink-0 ml-2">{p.units} sold · {formatMoney(p.revenue)}</span>
                </div>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <div className="h-full bg-brand rounded-full" style={{ width: `${Math.round((p.units / maxUnits) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top customers */}
        <div className="bg-paper border border-line rounded-card p-6">
          <h2 className="font-semibold mb-4">Top customers</h2>
          <div className="divide-y divide-line">
            {topCustomers.map(([email, c]) => (
              <div key={email} className="flex items-center justify-between py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted truncate">{email}</p>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <p className="text-sm font-semibold">{formatMoney(c.spent)}</p>
                  <p className="text-xs text-muted">{c.orders} order{c.orders > 1 ? "s" : ""}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Repeat behavior */}
        <div className="bg-paper border border-line rounded-card p-6">
          <h2 className="font-semibold mb-4">Repeat customers</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="font-display text-2xl font-semibold">{repeat}</p>
              <p className="text-xs text-muted mt-0.5">Repeat buyers</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold">{repeatRate}%</p>
              <p className="text-xs text-muted mt-0.5">Repeat rate</p>
            </div>
            <div>
              <p className="font-display text-2xl font-semibold">{avgOrders}</p>
              <p className="text-xs text-muted mt-0.5">Orders / customer</p>
            </div>
          </div>
        </div>

        {/* Drop performance */}
        <div className="bg-paper border border-line rounded-card p-6">
          <h2 className="font-semibold mb-4">Drop performance</h2>
          <div className="space-y-4">
            {dropRows.map((d) => (
              <div key={d.title}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="truncate">{d.title}</span>
                  <span className="text-muted shrink-0 ml-2">{d.orders} orders · {formatMoney(d.revenue)}</span>
                </div>
                <div className="h-2 rounded-full bg-line overflow-hidden">
                  <div className="h-full bg-sage rounded-full" style={{ width: `${Math.round((d.revenue / maxDropRev) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI teaser */}
      <div className="rounded-card p-6 bg-ink text-cream flex flex-wrap items-center justify-between gap-4">
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
