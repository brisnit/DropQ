import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui";
import { formatMoney, statusStyle } from "@/lib/format";
import { orderStatusLabel } from "@/lib/orders";
import { categoryLabel } from "@/lib/category";
import { dropImage, orderStatusLine, type OrderCard, type UpcomingDrop, type FollowedVendorCard } from "@/lib/my-dropq";

const TZ = "America/Los_Angeles";

/** Horizontal rail. Scrolls on touch, snaps, no scrollbar chrome. */
export function Rail({
  title,
  action,
  children,
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="mb-9">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        {action && (
          <Link href={action.href} className="text-sm font-medium text-brand hover:underline shrink-0">
            {action.label}
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
        {children}
      </div>
    </section>
  );
}

/** An order in flight. Leads with what happens next, not the order number. */
export function ActiveOrderCard({ order }: { order: OrderCard }) {
  const img = dropImage(order);
  const pickup = order.drop.pickupStartAt;

  return (
    <Link
      href={`/my/orders/${order.id}`}
      className="snap-start shrink-0 w-[19rem] bg-paper border border-line rounded-card overflow-hidden hover:border-ink/25 transition"
    >
      <div className="flex">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-24 h-24 object-cover shrink-0" />
        ) : (
          <div className="w-24 h-24 shrink-0 bg-grey-tint flex items-center justify-center text-2xl">
            🛍️
          </div>
        )}
        <div className="p-3.5 min-w-0 flex-1">
          <Badge className={statusStyle(order.status)}>{orderStatusLine(order)}</Badge>
          <p className="font-display font-semibold truncate mt-1.5">{order.seller.storeName}</p>
          <p className="text-xs text-muted truncate">{order.drop.title}</p>
          {pickup && (
            <p className="text-xs text-ink-soft mt-1">
              {pickup.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })}
              {" · "}
              {pickup.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

/** A drop from someone they follow — the reason following is worth doing. */
export function DropCard({ drop }: { drop: UpcomingDrop }) {
  return (
    <Link
      href={drop.href}
      className="snap-start shrink-0 w-56 bg-paper border border-line rounded-card overflow-hidden hover:border-ink/25 transition"
    >
      {drop.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={drop.image} alt="" className="w-full h-32 object-cover" />
      ) : (
        <div className="w-full h-32 bg-grey-tint flex items-center justify-center text-3xl">🎁</div>
      )}
      <div className="p-3.5">
        <div className="flex items-center gap-2">
          <Avatar name={drop.seller.storeName} imageUrl={drop.seller.logoUrl} size="sm" seed={drop.seller.id} />
          <span className="text-xs text-muted truncate">{drop.seller.storeName}</span>
        </div>
        <p className="font-display font-semibold truncate mt-1.5">{drop.title}</p>
        {drop.canOrder ? (
          <p className="text-xs font-semibold text-brand mt-1">
            {drop.closesAt
              ? `Ordering closes ${drop.closesAt.toLocaleDateString("en-US", { weekday: "short", timeZone: TZ })}`
              : "Ordering open"}
          </p>
        ) : (
          <p className="text-xs text-muted mt-1">
            {drop.opensAt
              ? `Opens ${drop.opensAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })}`
              : "Coming soon"}
          </p>
        )}
      </div>
    </Link>
  );
}

/** A vendor they follow. */
export function VendorCard({ vendor }: { vendor: FollowedVendorCard }) {
  return (
    <Link
      href={`/s/${vendor.slug}`}
      className="snap-start shrink-0 w-44 bg-paper border border-line rounded-card p-4 text-center hover:border-ink/25 transition"
    >
      <div className="flex justify-center">
        <Avatar name={vendor.storeName} imageUrl={vendor.logoUrl} size="lg" seed={vendor.sellerId} />
      </div>
      <p className="font-display font-semibold truncate mt-2.5">{vendor.storeName}</p>
      <p className="text-xs text-muted truncate">
        {[categoryLabel(vendor.category), vendor.city].filter(Boolean).join(" · ")}
      </p>
      {vendor.liveDrop ? (
        <span className="inline-block mt-2 text-[11px] font-semibold px-2 py-0.5 rounded-pill bg-brand-tint text-brand-dark">
          Live drop
        </span>
      ) : vendor.orderCount > 0 ? (
        <span className="inline-block mt-2 text-[11px] text-muted">
          {vendor.orderCount} order{vendor.orderCount === 1 ? "" : "s"}
        </span>
      ) : null}
    </Link>
  );
}

/** Past order row — compact, since the drop history view carries the emotion. */
export function PastOrderRow({ order }: { order: OrderCard }) {
  const img = dropImage(order);
  return (
    <Link
      href={`/my/orders/${order.id}`}
      className="flex items-center gap-3 p-3 bg-paper border border-line rounded-card hover:border-ink/25 transition"
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-xl bg-grey-tint shrink-0 flex items-center justify-center">🧾</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{order.seller.storeName}</p>
        <p className="text-xs text-muted truncate">
          {order.drop.title} ·{" "}
          {order.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ })}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold text-sm">{formatMoney(order.totalCents)}</p>
        <p className="text-[11px] text-muted">{orderStatusLabel(order.status)}</p>
      </div>
    </Link>
  );
}

export function EmptyRail({ text, cta }: { text: string; cta?: { href: string; label: string } }) {
  return (
    <div className="w-full bg-paper border border-dashed border-line-strong rounded-card p-6 text-center">
      <p className="text-sm text-muted">{text}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-3 inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}
