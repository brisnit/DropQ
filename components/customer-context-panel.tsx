import Link from "next/link";
import { Badge } from "@/components/ui";
import { formatMoney, formatDate, statusStyle } from "@/lib/format";
import { orderStatusLabel } from "@/lib/orders";
import type { CustomerContext } from "@/lib/messaging";

/**
 * "Who am I talking to" — deliberately not a CRM. Just enough for a vendor
 * mid-drop to place the person: how to reach them, what they ordered, and
 * whether they're a regular. Collapsed by default on mobile via <details> so
 * the thread keeps the screen.
 */
export function CustomerContextPanel({ ctx }: { ctx: CustomerContext }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Email", value: <a href={`mailto:${ctx.email}`} className="hover:underline break-all">{ctx.email}</a> },
    ...(ctx.phone
      ? [{ label: "Phone", value: <a href={`tel:${ctx.phone}`} className="hover:underline">{ctx.phone}</a> }]
      : []),
    {
      label: "Current order",
      value: ctx.currentOrder ? (
        <span className="inline-flex items-center gap-2 flex-wrap">
          {formatMoney(ctx.currentOrder.totalCents)}
          <Badge className={statusStyle(ctx.currentOrder.status)}>
            {orderStatusLabel(ctx.currentOrder.status)}
          </Badge>
          <span className="text-muted text-xs">{formatDate(ctx.currentOrder.createdAt)}</span>
        </span>
      ) : (
        <span className="text-muted">None yet</span>
      ),
    },
    {
      label: "Current drop",
      value: ctx.currentDrop ? (
        <Link href={`/dashboard/drops/${ctx.currentDrop.id}`} className="text-brand hover:underline">
          {ctx.currentDrop.title}
        </Link>
      ) : (
        <span className="text-muted">—</span>
      ),
    },
    { label: "Drops joined", value: String(ctx.dropsParticipated) },
    { label: "Total orders", value: String(ctx.totalOrders) },
  ];

  const list = (
    <dl className="px-4 pb-4 pt-3 space-y-2.5 border-t border-line">
      {rows.map((r) => (
        <div key={r.label} className="flex items-start justify-between gap-3 text-sm">
          <dt className="text-muted shrink-0">{r.label}</dt>
          <dd className="text-right min-w-0">{r.value}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <>
      {/* Narrow screens: a 48px summary bar the vendor taps open, so the thread
          keeps the screen during a live drop. */}
      <details className="group xl:hidden bg-paper border border-line rounded-card overflow-hidden">
        <summary className="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer list-none min-h-[48px] hover:bg-cream/70 transition">
          <span className="font-display font-semibold text-sm">Customer details</span>
          <span
            className="text-muted text-xs group-open:rotate-180 transition-transform"
            aria-hidden
          >
            ▾
          </span>
        </summary>
        {list}
      </details>

      {/* Wide screens: always visible in the right rail. */}
      <div className="hidden xl:block bg-paper border border-line rounded-card overflow-hidden">
        <div className="px-4 py-3">
          <span className="font-display font-semibold text-sm">Customer details</span>
        </div>
        {list}
      </div>
    </>
  );
}
