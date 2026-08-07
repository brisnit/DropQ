import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-auth";
import { customerOrder, dropImage } from "@/lib/my-dropq";
import { messageVendorFromOrderAction } from "@/lib/actions/my-dropq";
import { formatMoney, formatDateTime, statusStyle } from "@/lib/format";
import { orderStatusLabel, paymentLabel, paymentStyle } from "@/lib/orders";
import { createMapsUrl } from "@/lib/maps";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/avatar";

export const metadata = { title: "Order — My DropQ" };

const TZ = "America/Los_Angeles";

export default async function MyOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await requireCustomer(`/my/orders/${id}`);

  // Scoped lookup — someone else's order id 404s rather than leaking a receipt.
  const order = await customerOrder(customer.id, id);
  if (!order) notFound();

  const img = dropImage(order);
  const mapsUrl = createMapsUrl({ address: order.drop.pickupAddress });
  const isActive = ["new", "in_progress", "ready"].includes(order.status);

  return (
    <>
      <Link href="/my/orders" className="text-sm text-muted hover:text-ink">
        ← Orders
      </Link>

      <div className="bg-paper border border-line rounded-card overflow-hidden mt-3">
        {img && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="w-full h-40 sm:h-52 object-cover" />
        )}
        <div className="p-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={statusStyle(order.status)}>{orderStatusLabel(order.status)}</Badge>
            <Badge className={paymentStyle(order.paymentStatus)}>
              {paymentLabel(order.paymentStatus)}
            </Badge>
          </div>

          <h1 className="font-display text-2xl font-semibold tracking-tight mt-2">
            {order.drop.title}
          </h1>

          <Link
            href={`/s/${order.seller.slug}`}
            className="inline-flex items-center gap-2 mt-3 hover:underline"
          >
            <Avatar
              name={order.seller.storeName}
              imageUrl={order.seller.logoUrl}
              size="sm"
              seed={order.seller.id}
            />
            <span className="font-medium">{order.seller.storeName}</span>
          </Link>

          <p className="text-xs text-muted mt-2">
            Ordered {formatDateTime(order.createdAt)}
          </p>
        </div>
      </div>

      {/* Pickup — the thing an active order is really about */}
      {isActive && (order.drop.pickupStartAt || order.drop.pickupAddress) && (
        <section className="bg-paper border border-line rounded-card p-5 mt-4">
          <h2 className="font-semibold">
            {order.drop.fulfillment === "delivery" ? "Delivery" : "Pickup"}
          </h2>
          {order.drop.pickupStartAt && (
            <p className="text-ink-soft mt-1">
              {order.drop.pickupStartAt.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                timeZone: TZ,
              })}
              {" · "}
              {order.drop.pickupStartAt.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: TZ,
              })}
              {order.drop.pickupEndAt
                ? `–${order.drop.pickupEndAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ })}`
                : ""}
            </p>
          )}
          {(order.drop.pickupLocationName || order.drop.pickupAddress) && (
            <p className="text-sm text-muted mt-1">
              {[order.drop.pickupLocationName, order.drop.pickupAddress].filter(Boolean).join(" · ")}
            </p>
          )}
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
            >
              🧭 Directions
            </a>
          )}
        </section>
      )}

      {/* Items + receipt */}
      <section className="bg-paper border border-line rounded-card p-5 mt-4">
        <h2 className="font-semibold mb-3">What you ordered</h2>
        <ul className="divide-y divide-line">
          {order.items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="text-muted">{it.quantity}×</span> {it.name}
              </span>
              <span className="font-medium shrink-0">
                {formatMoney(it.priceCents * it.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-line pt-3 mt-1">
          <span className="font-semibold">Total</span>
          <span className="font-display text-xl font-semibold">{formatMoney(order.totalCents)}</span>
        </div>
        {order.note && <p className="text-sm text-muted italic mt-3">“{order.note}”</p>}
      </section>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-4">
        <form action={messageVendorFromOrderAction}>
          <input type="hidden" name="orderId" value={order.id} />
          <button className="inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold transition active:scale-[0.98]">
            💬 Message {order.seller.storeName}
          </button>
        </form>
        <Link
          href={`/s/${order.seller.slug}`}
          className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
        >
          Order again
        </Link>
        <Link
          href={`/order/${order.id}`}
          className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
        >
          Receipt
        </Link>
      </div>

      {/* Timeline */}
      {order.events.length > 0 && (
        <section className="mt-6">
          <h2 className="font-semibold mb-2">Progress</h2>
          <ol className="border-l border-line ml-2 space-y-3">
            {order.events.map((e) => (
              <li key={e.id} className="pl-4 relative">
                <span
                  className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-line-strong"
                  aria-hidden
                />
                <p className="text-sm">
                  {e.type === "created"
                    ? "Order placed"
                    : e.type === "payment"
                      ? `Payment ${e.detail ?? "updated"}`
                      : orderStatusLabel(e.detail ?? "")}
                </p>
                <p className="text-xs text-muted">{formatDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
