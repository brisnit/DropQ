import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, formatDate, relativeTime, statusStyle } from "@/lib/format";
import { Stat } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";

const PAID = ["new", "ready", "fulfilled"];

export default async function AdminClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seller = await prisma.seller.findUnique({
    where: { id },
    include: {
      drops: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { orders: true, products: true } } },
      },
      _count: { select: { subscribers: true } },
    },
  });
  if (!seller) notFound();

  const [agg, customerGroups, recent] = await Promise.all([
    prisma.order.aggregate({
      where: { sellerId: id, status: { in: PAID } },
      _sum: { totalCents: true, feeCents: true },
      _count: true,
    }),
    prisma.order.groupBy({ by: ["buyerEmail"], where: { sellerId: id, status: { in: PAID } }, _count: true }),
    prisma.order.findMany({
      where: { sellerId: id, status: { not: "pending" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { drop: { select: { title: true } } },
    }),
  ]);

  const sales = agg._sum.totalCents ?? 0;
  const fees = agg._sum.feeCents ?? 0;

  return (
    <div>
      <Link href="/admin" className="text-sm text-muted hover:text-ink">← All clients</Link>

      <div className="flex flex-wrap items-start justify-between gap-4 mt-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight">{seller.storeName}</h1>
            {seller.isAdmin && <Badge className="bg-ink text-cream">admin</Badge>}
            {seller.stripeChargesEnabled && <Badge className="bg-sage-tint text-sage">payouts on</Badge>}
          </div>
          <p className="text-muted mt-1">
            {seller.email} · /s/{seller.slug} · joined {formatDate(seller.createdAt)}
            {seller.location ? ` · ${seller.location}` : ""}
          </p>
        </div>
        <Link
          href={`/s/${seller.slug}`}
          target="_blank"
          className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
        >
          View storefront ↗
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <Stat label="Sales" value={formatMoney(sales)} />
        <Stat label="DropQ fees" value={formatMoney(fees)} />
        <Stat label="Orders" value={String(agg._count)} />
        <Stat label="Customers" value={String(customerGroups.length)} />
        <Stat label="Sign-ups" value={String(seller._count.subscribers)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Drops */}
        <div>
          <h2 className="font-semibold mb-3">Drops ({seller.drops.length})</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {seller.drops.length === 0 && <p className="p-5 text-sm text-muted">No drops yet.</p>}
            {seller.drops.map((d) => (
              <div key={d.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <p className="text-xs text-muted">{d._count.products} items · {d._count.orders} orders · {formatDate(d.createdAt)}</p>
                </div>
                <Badge className={statusStyle(d.status)}>{d.status}</Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div>
          <h2 className="font-semibold mb-3">Recent activity</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {recent.length === 0 && <p className="p-5 text-sm text-muted">No orders yet.</p>}
            {recent.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{o.buyerName}</p>
                  <p className="text-xs text-muted truncate">{o.drop.title} · {relativeTime(o.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={statusStyle(o.status)}>{o.status}</Badge>
                  <span className="text-sm font-semibold">{formatMoney(o.totalCents)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
