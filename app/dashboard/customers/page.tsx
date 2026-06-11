import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney, formatDate } from "@/lib/format";
import { PageHeader, EmptyState, Section } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";

export const metadata = { title: "Customers — DropQ" };

type Cust = {
  name: string;
  email: string;
  phone: string | null;
  orders: number;
  spent: number;
  last: Date;
};

export default async function CustomersPage() {
  const seller = await requireSeller();
  const orders = await prisma.order.findMany({
    where: { sellerId: seller.id, status: { not: "pending" } },
    orderBy: { createdAt: "desc" },
    select: {
      buyerName: true,
      buyerEmail: true,
      buyerPhone: true,
      totalCents: true,
      createdAt: true,
    },
  });

  const map = new Map<string, Cust>();
  for (const o of orders) {
    const c = map.get(o.buyerEmail);
    if (c) {
      c.orders += 1;
      c.spent += o.totalCents;
      if (o.createdAt > c.last) c.last = o.createdAt;
    } else {
      map.set(o.buyerEmail, {
        name: o.buyerName,
        email: o.buyerEmail,
        phone: o.buyerPhone,
        orders: 1,
        spent: o.totalCents,
        last: o.createdAt,
      });
    }
  }
  const customers = [...map.values()].sort((a, b) => b.spent - a.spent);
  const repeat = customers.filter((c) => c.orders > 1).length;

  return (
    <Section>
      <PageHeader
        title="Customers"
        subtitle="Your list — the most valuable thing you build on DropQ. It's yours to keep."
      />

      {customers.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="No customers yet"
          body="Every order adds the buyer here automatically, so you can bring them back for the next drop."
          ctaHref="/dashboard/drops/new"
          ctaLabel="Create a drop"
        />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-paper border border-line rounded-card p-4">
              <p className="text-xs text-muted uppercase tracking-wide">Total</p>
              <p className="font-display text-2xl font-semibold mt-1">{customers.length}</p>
            </div>
            <div className="bg-paper border border-line rounded-card p-4">
              <p className="text-xs text-muted uppercase tracking-wide">Repeat</p>
              <p className="font-display text-2xl font-semibold mt-1">{repeat}</p>
            </div>
            <div className="bg-paper border border-line rounded-card p-4">
              <p className="text-xs text-muted uppercase tracking-wide">Repeat rate</p>
              <p className="font-display text-2xl font-semibold mt-1">
                {Math.round((repeat / customers.length) * 100)}%
              </p>
            </div>
          </div>

          <div className="bg-paper border border-line rounded-card overflow-hidden">
            <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-5 py-3 border-b border-line text-xs font-semibold uppercase tracking-wide text-muted">
              <span>Customer</span>
              <span className="text-right">Orders</span>
              <span className="text-right">Spent</span>
              <span className="text-right">Last order</span>
            </div>
            <div className="divide-y divide-line">
              {customers.map((c) => (
                <div
                  key={c.email}
                  className="grid grid-cols-2 sm:grid-cols-[2fr_1fr_1fr_1fr] gap-2 sm:gap-4 px-5 py-3.5 items-center"
                >
                  <div className="min-w-0 col-span-2 sm:col-span-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{c.name}</span>
                      {c.orders > 1 && <Badge className="bg-teal-tint text-[#235c65]">Regular</Badge>}
                    </div>
                    <p className="text-xs text-muted truncate">{c.email}</p>
                  </div>
                  <span className="text-sm text-right sm:text-right">
                    <span className="sm:hidden text-muted text-xs">Orders </span>{c.orders}
                  </span>
                  <span className="text-sm font-semibold text-right">{formatMoney(c.spent)}</span>
                  <span className="text-sm text-muted text-right hidden sm:block">{formatDate(c.last)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}
