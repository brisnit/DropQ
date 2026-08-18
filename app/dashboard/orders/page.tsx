import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateOrderStatusAction } from "@/lib/actions/dashboard";
import { formatMoney, relativeTime, statusStyle } from "@/lib/format";
import { orderStatusLabel, paymentLabel, paymentStyle } from "@/lib/orders";
import { PageHeader, EmptyState, Section } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { StatusSelect } from "@/components/status-select";
import { MessageCustomerButton } from "@/components/message-customer-button";

export const metadata = { title: "Orders — DropQ" };

const FILTERS = ["all", "new", "in_progress", "ready", "completed", "canceled"] as const;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const seller = await requireSeller();
  const { status } = await searchParams;
  const filter = FILTERS.includes(status as (typeof FILTERS)[number]) ? status! : "all";

  const orders = await prisma.order.findMany({
    where: {
      sellerId: seller.id,
      ...(filter !== "all"
        ? { status: filter === "completed" ? { in: ["completed", "fulfilled"] } : filter }
        : { status: { not: "pending" } }),
    },
    orderBy: { createdAt: "desc" },
    include: { items: true, drop: { select: { title: true, id: true } } },
  });

  const counts = await prisma.order.groupBy({
    by: ["status"],
    where: { sellerId: seller.id, status: { not: "pending" } },
    _count: true,
  });
  const countFor = (s: string) =>
    s === "all"
      ? counts.reduce((a, c) => a + c._count, 0)
      : counts.find((c) => c.status === s)?._count ?? 0;

  return (
    <Section>
      <PageHeader title="Orders" subtitle="Every order across all your drops, newest first." />

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/dashboard/orders" : `/dashboard/orders?status=${f}`}
            className={`inline-flex items-center min-h-11 px-3.5 py-1.5 rounded-pill text-sm font-medium transition ${
              filter === f
                ? "bg-ink text-cream"
                : "bg-paper border border-line text-ink-soft hover:border-ink/25"
            }`}
          >
            {f === "all" ? "All" : orderStatusLabel(f)} <span className="opacity-60">{countFor(f)}</span>
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <EmptyState
          emoji="🧾"
          title="No orders here"
          body="When customers check out, their orders show up here ready to prepare and fulfill."
          ctaHref="/dashboard/drops"
          ctaLabel="View your drops"
        />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="bg-paper border border-line rounded-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{o.buyerName}</p>
                    <Badge className={statusStyle(o.status)}>{orderStatusLabel(o.status)}</Badge>
                    <Badge className={paymentStyle(o.paymentStatus)}>{paymentLabel(o.paymentStatus)}</Badge>
                    {o.source === "in_person" && <Badge className="bg-quad/15 text-tertiary">in person</Badge>}
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {o.buyerEmail}
                    {o.buyerPhone ? ` · ${o.buyerPhone}` : ""} · {relativeTime(o.createdAt)}
                  </p>
                  <Link
                    href={`/dashboard/drops/${o.drop.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    {o.drop.title}
                  </Link>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                    {o.items.map((it) => (
                      <li key={it.id}>
                        <span className="text-muted">{it.quantity}×</span> {it.name}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap">
                  <span className="font-semibold">{formatMoney(o.totalCents)}</span>
                  <MessageCustomerButton orderId={o.id} />
                  <StatusSelect action={updateOrderStatusAction} orderId={o.id} value={o.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
