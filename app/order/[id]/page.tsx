import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { finalizePaidOrder } from "@/lib/checkout";
import { customerArrivedAction } from "@/lib/actions/order";
import { formatMoney } from "@/lib/format";
import { formatPickupWindow, pickupLocation } from "@/lib/pickup";
import { dropMapsUrl } from "@/lib/maps";
import { vendorPalette } from "@/lib/color";
import { DiscoveryLink } from "@/components/discovery-link";

export const metadata = { title: "Order confirmed — DropQ" };

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string; arrived?: string }>;
}) {
  const { id } = await params;
  const { session_id, arrived } = await searchParams;

  const sellerSelect = {
    storeName: true,
    slug: true,
    accent: true,
    logoUrl: true,
    stripeAccountId: true,
    timezone: true,
    pickupContactPhone: true,
    pickupContactPref: true,
  } as const;

  let order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, drop: true, seller: { select: sellerSelect } },
  });
  if (!order) notFound();

  // Returning from Stripe Checkout — verify payment and finalize (idempotent).
  // Direct-charge sessions live on the vendor's connected account, so retrieve
  // with that account context.
  const stripe = getStripe();
  if (order.status === "pending" && session_id && stripe && order.seller.stripeAccountId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(
        session_id,
        {},
        { stripeAccount: order.seller.stripeAccountId }
      );
      if (session.payment_status === "paid") {
        const pi =
          typeof session.payment_intent === "string" ? session.payment_intent : null;
        await finalizePaidOrder(order.id, pi);
        order = await prisma.order.findUnique({
          where: { id },
          include: { items: true, drop: true, seller: { select: sellerSelect } },
        });
      }
    } catch {
      /* ignore — show pending state below */
    }
  }
  if (!order) notFound();

  const accent = order.seller.accent || "#ff6268";
  // Accessible CTA color derived from the vendor's brand color for buttons/
  // banners with white text (keeps light brand colors readable).
  const cta = vendorPalette(accent).vendor_cta_color;
  const pending = order.status === "pending";
  const paidWithStripe = !!order.stripeSessionId && !pending;
  const payInPerson = order.paymentStatus === "unpaid" && order.source === "live";
  const itemsSum = order.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const serviceFee = Math.max(0, order.totalCents - itemsSum);

  return (
    <main className="min-h-screen grid place-items-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="bg-paper border border-line rounded-card shadow-[var(--shadow-soft)] overflow-hidden">
          <div
            className="p-7 text-center text-white"
            style={{ backgroundColor: pending ? "#79706a" : cta }}
          >
            <div className="w-14 h-14 rounded-full bg-white/20 grid place-items-center text-3xl mx-auto">
              {pending ? "⏳" : "✓"}
            </div>
            <h1 className="font-display text-2xl font-semibold mt-4">
              {pending ? "Finishing your payment…" : "Order confirmed!"}
            </h1>
            <p className="text-white/85 mt-1">
              {pending
                ? "We're waiting on payment confirmation. Refresh in a moment."
                : `Thanks, ${order.buyerName.split(" ")[0]} — ${order.seller.storeName} got your order.`}
            </p>
          </div>

          <div className="p-6">
            <p className="text-xs uppercase tracking-wider text-muted">Order</p>
            <p className="font-mono text-sm">#{order.id.slice(-8).toUpperCase()}</p>

            <div className="mt-4 border border-line rounded-xl divide-y divide-line">
              {order.items.map((it) => (
                <div key={it.id} className="flex justify-between px-4 py-2.5 text-sm">
                  <span>
                    <span className="text-muted">{it.quantity}×</span> {it.name}
                  </span>
                  <span className="font-medium">{formatMoney(it.priceCents * it.quantity)}</span>
                </div>
              ))}
              {serviceFee > 0 && (
                <div className="flex justify-between px-4 py-2.5 text-sm text-muted">
                  <span>Service fee</span>
                  <span>{formatMoney(serviceFee)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 font-semibold">
                <span>Total {paidWithStripe ? "paid" : ""}</span>
                <span>{formatMoney(order.totalCents)}</span>
              </div>
            </div>

            {(() => {
              const win = formatPickupWindow(order.drop, order.seller.timezone);
              const where = pickupLocation(order.drop);
              const mapsUrl = dropMapsUrl(order.drop);
              const findMe = order.drop.pickupFindMe;
              const isDelivery = order.drop.fulfillment === "delivery";
              const label = isDelivery ? "Delivery" : "Pickup";
              const phone = order.seller.pickupContactPhone;
              const pref = order.seller.pickupContactPref;
              const canCheckIn = !["pending", "canceled", "completed"].includes(order.status);
              const hasPickup = win || where || findMe || order.drop.pickupNotes;
              if (!hasPickup && !phone && !canCheckIn) return null;
              return (
                <div className="mt-5 space-y-3">
                  {/* Vendor arrived banner */}
                  {order.drop.vendorArrivedAt && canCheckIn && (
                    <div className="rounded-xl bg-sage-tint border border-sage/30 text-sage px-4 py-3 text-sm font-medium">
                      📍 {order.seller.storeName} has arrived and is ready for you.
                    </div>
                  )}

                  {/* Pickup time */}
                  {win && (
                    <div className="bg-cream border border-line rounded-xl p-4">
                      <p className="text-xs uppercase tracking-wider text-muted">{label} time</p>
                      <p className="text-sm mt-1 font-medium">{win}</p>
                    </div>
                  )}

                  {/* Pickup location + Open in Maps */}
                  {where && (
                    <div className="bg-cream border border-line rounded-xl p-4">
                      <p className="text-xs uppercase tracking-wider text-muted">{label} location</p>
                      <p className="text-sm mt-1">{where}</p>
                      {mapsUrl && (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center justify-center gap-2 w-full sm:w-auto text-sm font-semibold rounded-xl px-4 py-2.5 text-white"
                          style={{ backgroundColor: cta }}
                        >
                          📍 Open in Maps
                        </a>
                      )}
                    </div>
                  )}

                  {/* How to find the vendor */}
                  {findMe && (
                    <div className="bg-cream border border-line rounded-xl p-4 flex items-start gap-3">
                      {order.seller.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={order.seller.logoUrl} alt={order.seller.storeName} className="w-11 h-11 rounded-lg object-cover border border-line shrink-0" />
                      ) : (
                        <span className="w-11 h-11 rounded-lg grid place-items-center text-white font-semibold shrink-0" style={{ backgroundColor: cta }}>
                          {order.seller.storeName.charAt(0)}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wider text-muted">How to find us</p>
                        <p className="text-sm mt-1">{findMe}</p>
                      </div>
                    </div>
                  )}

                  {order.drop.pickupNotes && (
                    <div className="bg-cream border border-line rounded-xl p-4">
                      <p className="text-xs uppercase tracking-wider text-muted">Notes</p>
                      <p className="text-sm mt-1 text-ink-soft">{order.drop.pickupNotes}</p>
                    </div>
                  )}

                  {/* Message the vendor inside DropQ — the conversation lives
                      here, so replies land in their dashboard rather than a
                      personal phone. Signing in is a one-tap emailed link. */}
                  <Link
                    href="/messages"
                    className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-xl px-4 py-3.5 min-h-[48px] bg-ink text-cream hover:bg-ink-soft transition"
                  >
                    💬 Message {order.seller.storeName}
                  </Link>

                  {/* Contact vendor */}
                  {phone && (
                    <div className="grid grid-cols-2 gap-2">
                      {pref !== "text" && (
                        <a href={`tel:${phone}`} className="inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-xl px-4 py-3 border border-line-strong bg-paper hover:border-ink/30 transition">
                          📞 Call vendor
                        </a>
                      )}
                      {pref !== "call" && (
                        <a href={`sms:${phone}`} className={`inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-xl px-4 py-3 border border-line-strong bg-paper hover:border-ink/30 transition ${pref === "text" ? "col-span-2" : ""}`}>
                          💬 Text vendor
                        </a>
                      )}
                    </div>
                  )}

                  {/* I'm here */}
                  {canCheckIn && (
                    order.customerArrivedAt || arrived ? (
                      <div className="rounded-xl bg-grey-tint text-[#3f434b] px-4 py-3 text-sm text-center font-medium">
                        ✓ You&apos;re checked in — {order.seller.storeName} has been notified you&apos;re here.
                      </div>
                    ) : (
                      <form action={customerArrivedAction}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <button
                          type="submit"
                          className="w-full inline-flex items-center justify-center gap-2 text-base font-semibold rounded-xl px-4 py-3.5 text-white"
                          style={{ backgroundColor: cta }}
                        >
                          🙋 I&apos;m here
                        </button>
                      </form>
                    )
                  )}
                </div>
              );
            })()}

            <p className="text-sm text-muted mt-4">
              A receipt is on its way to <span className="text-ink">{order.buyerEmail}</span>.
            </p>

            <Link
              href={`/s/${order.seller.slug}`}
              className="block text-center mt-5 text-sm font-semibold rounded-xl py-3 text-white"
              style={{ backgroundColor: cta }}
            >
              Back to {order.seller.storeName}
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-5">
          {paidWithStripe
            ? "Paid securely with Stripe."
            : payInPerson
              ? "Pay the seller in person."
              : "Demo order — no payment taken."}
        </p>

        {/* Secondary discovery — only after a completed order, and visually
            below/quieter than the confirmation + vendor info above. */}
        {!pending && (
          <div className="mt-8 border-t border-line pt-6 text-center">
            <h2 className="font-display text-lg font-semibold">See what else is dropping nearby</h2>
            <p className="text-sm text-muted mt-1 max-w-xs mx-auto">
              Discover other local vendors, pop-ups, and upcoming drops on DropQ.
            </p>
            <DiscoveryLink
              event="post_checkout_discovery_cta"
              className="inline-block mt-4 text-sm font-semibold rounded-xl px-5 py-2.5 border border-line-strong bg-paper hover:border-ink/30 transition"
            >
              Explore Nearby Drops
            </DiscoveryLink>
          </div>
        )}

        {/* Subtle post-order upsell — the only place we mention DropQ to a buyer */}
        <p className="text-center text-sm text-muted mt-6 flex items-center justify-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/dropq-mark.png" alt="DropQ" className="h-4 w-auto" /> Want a store like this?{" "}
          <Link href="/" className="text-ink font-medium hover:underline">
            Start your own free →
          </Link>
        </p>
      </div>
    </main>
  );
}
