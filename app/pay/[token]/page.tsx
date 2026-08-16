import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { formatMoney } from "@/lib/format";
import { vendorPalette } from "@/lib/color";
import { isWalkUpEnabled, walkUpMode, linesFromJson, walkUpSaleState, walkUpTotalCents } from "@/lib/walkup";
import { PayForm } from "./pay-form";

export const metadata = { title: "Pay — DropQ" };

/**
 * The customer's walk-up payment page (Phase E).
 *
 * Authorised purely by possession of the unguessable token, and scoped to
 * paying that one quoted sale. It grants no account access and cannot mutate
 * anything else.
 *
 * ⚠️ Gated by `isWalkUpEnabled()` — a genuine kill switch, not just a hidden
 * vendor button. With the flag off this route does not exist.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center px-5 py-10">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

function Dead({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="bg-paper border border-line rounded-card p-7 text-center">
        <div className="text-4xl">⏳</div>
        <h1 className="font-display text-xl font-semibold mt-3">{title}</h1>
        <p className="text-muted mt-2">{body}</p>
      </div>
    </Shell>
  );
}

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ canceled?: string }>;
}) {
  // Off for everyone: 404 before any lookup. In "internal" mode we must resolve
  // the sale's seller first — but the response is an identical notFound() in
  // both cases, so this never reveals whether a token exists.
  if (walkUpMode() === "off") notFound();

  const { token } = await params;
  const { canceled } = await searchParams;

  const sale = await prisma.walkUpSale.findUnique({
    where: { token },
    include: {
      seller: { select: { storeName: true, logoUrl: true, accent: true, slug: true, stripeAccountId: true, internalKind: true } },
    },
  });
  if (!sale) notFound();
  if (!isWalkUpEnabled(sale.seller)) notFound();

  const state = walkUpSaleState(sale);
  const store = sale.seller.storeName;

  if (state === "expired") {
    return <Dead title="This payment link has expired"
      body={`Ask ${store} to start a new sale — it only takes a moment.`} />;
  }
  if (state === "canceled") {
    return <Dead title="This sale was canceled"
      body={`${store} canceled this sale. Ask them to start a new one if you'd still like to buy.`} />;
  }

  // Already converted — recover rather than error. Resume the open Stripe
  // session if there is one, otherwise show the order they already have.
  if (state === "converted" && sale.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: sale.orderId },
      select: { id: true, paymentStatus: true, stripeSessionId: true },
    });
    if (order?.paymentStatus === "paid") {
      return <Dead title="This sale is already paid"
        body="Thanks! Your receipt is on its way by email." />;
    }
    const stripe = getStripe();
    if (order?.stripeSessionId && stripe && sale.seller.stripeAccountId) {
      try {
        const s = await stripe.checkout.sessions.retrieve(order.stripeSessionId, {}, {
          stripeAccount: sale.seller.stripeAccountId,
        });
        if (s.status === "open" && s.url) {
          return (
            <Shell>
              <div className="bg-paper border border-line rounded-card p-7 text-center">
                <h1 className="font-display text-xl font-semibold">Finish your payment</h1>
                <p className="text-muted mt-2">You already started paying {store}.</p>
                <a href={s.url}
                  className="block mt-5 text-center font-semibold rounded-xl py-3.5 text-white"
                  style={{ backgroundColor: vendorPalette(sale.seller.accent || "#ff6268").vendor_cta_color }}>
                  Continue to payment
                </a>
              </div>
            </Shell>
          );
        }
      } catch {
        /* fall through to the generic message */
      }
    }
    return <Dead title="This payment link was already used"
      body={`Ask ${store} to start a new sale if you still need to pay.`} />;
  }

  // ---- Open: show the quoted cart and take payment --------------------------
  const lines = linesFromJson(sale.lines);
  const total = walkUpTotalCents(lines);
  const accent = sale.seller.accent || "#ff6268";
  const cta = vendorPalette(accent).vendor_cta_color;
  const viewer = await getCurrentCustomer();

  return (
    <Shell>
      <div className="bg-paper border border-line rounded-card shadow-[var(--shadow-soft)] overflow-hidden">
        <div className="p-5 text-white text-center" style={{ backgroundColor: cta }}>
          {sale.seller.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sale.seller.logoUrl} alt="" className="w-12 h-12 rounded-full mx-auto object-cover" />
          )}
          <p className="font-display text-lg font-semibold mt-2">{store}</p>
          <p className="text-white/85 text-sm">Paying in person</p>
        </div>

        <div className="p-5">
          <ul className="space-y-2">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="text-muted">{l.quantity}×</span> {l.name}
                </span>
                <span className="tabular-nums shrink-0">
                  {formatMoney(l.priceCents * l.quantity)}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between mt-3 pt-3 border-t border-line-strong">
            <span className="font-semibold">Total</span>
            <span className="font-display text-2xl font-semibold tabular-nums">
              {formatMoney(total)}
            </span>
          </div>

          {canceled && (
            <p className="mt-3 text-sm text-muted bg-cream rounded-lg px-3 py-2">
              Payment canceled — you can try again below.
            </p>
          )}

          <div className="mt-5">
            <PayForm
              token={token}
              total={total}
              cta={cta}
              defaultEmail={viewer?.email}
              defaultName={viewer?.name?.split(" ")[0]}
            />
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-muted mt-4">
        <Link href={`/s/${sale.seller.slug}`} className="underline">See more from {store}</Link>
      </p>
    </Shell>
  );
}
