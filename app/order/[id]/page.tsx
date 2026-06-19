import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { finalizePaidOrder } from "@/lib/checkout";
import { Mark } from "@/components/logo";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Order confirmed — DropQ" };

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { id } = await params;
  const { session_id } = await searchParams;

  const sellerSelect = {
    storeName: true,
    slug: true,
    accent: true,
    stripeAccountId: true,
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

  const accent = order.seller.accent || "#d25b2a";
  const pending = order.status === "pending";
  const paidWithStripe = !!order.stripeSessionId && !pending;
  const itemsSum = order.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const serviceFee = Math.max(0, order.totalCents - itemsSum);

  return (
    <main className="min-h-screen grid place-items-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="bg-paper border border-line rounded-card shadow-[var(--shadow-soft)] overflow-hidden">
          <div
            className="p-7 text-center text-white"
            style={{ backgroundColor: pending ? "#79706a" : accent }}
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
                  <span>DropQ service fee</span>
                  <span>{formatMoney(serviceFee)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 font-semibold">
                <span>Total {paidWithStripe ? "paid" : ""}</span>
                <span>{formatMoney(order.totalCents)}</span>
              </div>
            </div>

            {order.drop.pickupInfo && (
              <div className="mt-4 bg-cream border border-line rounded-xl p-4">
                <p className="text-xs uppercase tracking-wider text-muted">
                  {order.drop.fulfillment}
                </p>
                <p className="text-sm font-medium mt-0.5">{order.drop.pickupInfo}</p>
              </div>
            )}

            <p className="text-sm text-muted mt-4">
              A receipt is on its way to <span className="text-ink">{order.buyerEmail}</span>.
            </p>

            <Link
              href={`/s/${order.seller.slug}`}
              className="block text-center mt-5 text-sm font-semibold rounded-xl py-3 text-white"
              style={{ backgroundColor: accent }}
            >
              Back to {order.seller.storeName}
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-muted mt-5 flex items-center justify-center gap-1.5">
          <Mark size={16} />
          {paidWithStripe ? "Paid securely with Stripe · Powered by DropQ" : "Powered by DropQ · Demo order, no payment taken"}
        </p>
      </div>
    </main>
  );
}
