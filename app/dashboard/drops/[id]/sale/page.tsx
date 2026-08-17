import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format";
import { canStartInPersonSale } from "@/lib/payments";
import {
  isWalkUpEnabled,
  walkUpSaleState,
  walkUpTotalCents,
  payUrlFor,
  WALKUP_TTL_MINUTES,
  type WalkUpLine,
} from "@/lib/walkup";
import { cancelWalkUpSaleAction } from "@/lib/actions/walkup";
import { ShareButton } from "@/components/share-button";
import { WalkUpCartScreen, WalkUpStatus } from "@/components/walkup-sale";

/**
 * The focused in-person sale screen.
 *
 * A route rather than a modal. On a phone this simply IS the screen — no
 * overlay, scroll-lock or focus-trap machinery, and back/refresh behave the way
 * a vendor expects. On desktop the same route renders as a narrow centred panel.
 *
 * Everything the drop page shows — share QR, stats, catalog, orders, messaging,
 * danger zone — is deliberately absent. A vendor standing in front of a customer
 * should be answering one question at a time: what are they buying, then have
 * they paid.
 *
 * ⚠️ Presentation only. The sale is still created by `startWalkUpSaleAction`,
 * cancelled by `cancelWalkUpSaleAction`, paid through `/pay/{token}` and
 * finalized by `finalizePaidOrder`. This file creates and mutates nothing.
 */
export default async function WalkUpSalePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ walkup?: string; walkup_error?: string }>;
}) {
  const { id } = await params;
  const { walkup: walkUpId, walkup_error: walkUpError } = await searchParams;
  const seller = await requireSeller();

  // Same gate as the drop page. With the flag off this route does not exist.
  if (!isWalkUpEnabled(seller)) notFound();

  const drop = await prisma.drop.findUnique({
    where: { id },
    include: { products: { orderBy: { sortOrder: "asc" } } },
  });
  if (!drop || drop.sellerId !== seller.id) notFound();

  // Same fallback as the drop page: without it a refresh mid-sale loses the QR
  // while the sale is still live.
  const sale = (walkUpId
    ? await prisma.walkUpSale.findFirst({
        where: { id: walkUpId, sellerId: seller.id, dropId: drop.id },
      })
    : null) ??
    (await prisma.walkUpSale.findFirst({
      where: {
        sellerId: seller.id,
        dropId: drop.id,
        orderId: null,
        canceledAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    }));

  const dropHref = `/dashboard/drops/${drop.id}`;
  const eligible = canStartInPersonSale(seller, drop);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;

  return (
    <main className="min-h-screen bg-cream">
      {/* max-w keeps desktop a focused column; on a phone it is the whole screen. */}
      {/* Vertical rhythm is deliberately tight on mobile: every pixel above the
          QR is a pixel the vendor may have to scroll past while a customer is
          waiting to scan it. */}
      <div className="mx-auto w-full max-w-2xl min-w-0 px-4 sm:px-6 py-4 sm:py-8">
        <div className="flex items-baseline justify-between gap-3 mb-3 sm:mb-5">
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-semibold tracking-tight truncate">
              {sale ? "In-person sale" : "New in-person sale"}
            </h1>
            <p className="text-xs sm:text-sm text-muted truncate">{drop.title}</p>
          </div>
          <Link
            href={dropHref}
            className="shrink-0 text-sm font-medium text-muted hover:text-ink transition"
          >
            Close
          </Link>
        </div>

        {walkUpError && (
          <p className="mb-4 text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">
            Couldn&apos;t start that sale ({walkUpError}). Nothing was created — try again.
          </p>
        )}

        {!sale ? (
          /* ---- Step 1: build the sale ------------------------------------ */
          !eligible.ok ? (
            <div className="bg-paper border border-line rounded-card p-6 text-center">
              <p className="text-muted">
                {eligible.reason === "vendor_not_sellable"
                  ? "Connect Stripe before taking in-person payments."
                  : eligible.reason === "no_stock"
                    ? "Everything in this drop is sold out."
                    : "This drop isn't available for in-person sales."}
              </p>
              <Link href={dropHref} className="inline-block mt-4 text-sm font-medium underline">
                Back to drop
              </Link>
            </div>
          ) : (
            <WalkUpCartScreen
              dropId={drop.id}
              cancelHref={dropHref}
              products={drop.products.map((p) => ({
                id: p.id,
                name: p.name,
                priceCents: p.priceCents,
                remaining: Math.max(0, p.inventory - p.sold),
              }))}
            />
          )
        ) : (
          /* ---- Steps 2 & 3: payment and status --------------------------- */
          await renderSale()
        )}
      </div>
    </main>
  );

  async function renderSale() {
    if (!sale) return null;
    const state = walkUpSaleState(sale);
    const lines = sale.lines as unknown as WalkUpLine[];
    const total = walkUpTotalCents(lines);
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    const payUrl = payUrlFor(sale.token, origin);
    const qr =
      state === "open"
        ? await QRCode.toDataURL(payUrl, { width: 640, margin: 1 })
        : null;

    return (
      <div className="space-y-4">
        <div className="bg-paper border border-line rounded-card p-3.5 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-display text-2xl font-semibold tabular-nums">
                {formatMoney(total)}
              </p>
              <p className="text-sm text-muted">
                {count} item{count === 1 ? "" : "s"} ·{" "}
                {state === "open" ? "awaiting payment" : state}
              </p>
            </div>
            {state === "open" && (
              <form action={cancelWalkUpSaleAction} className="shrink-0">
                <input type="hidden" name="saleId" value={sale.id} />
                <button
                  type="submit"
                  className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
                >
                  Cancel sale
                </button>
              </form>
            )}
          </div>
          <ul className="text-sm text-ink-soft mt-2 space-y-0.5">
            {lines.map((l) => (
              <li key={l.productId} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">
                  <span className="text-muted">{l.quantity}×</span> {l.name}
                </span>
                <span className="tabular-nums shrink-0">
                  {formatMoney(l.priceCents * l.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {state === "open" && qr && (
          <div className="rounded-card border-2 border-sage bg-sage-tint/40 p-3.5 sm:p-5">
            <p className="text-xs uppercase tracking-wider font-semibold text-sage">
              💳 Customer payment QR · in-person sale
            </p>
            <div className="mt-2.5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr}
                alt={`Payment QR — customer scans to pay ${formatMoney(total)}`}
                className="w-full max-w-[260px] sm:w-[220px] aspect-square self-center sm:self-auto shrink-0 rounded-xl border-2 border-sage bg-white p-2"
              />
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg sm:text-xl font-semibold">
                  Have the customer scan this to pay {formatMoney(total)}
                </p>
                <p className="text-sm text-muted mt-1">
                  {count} item{count === 1 ? "" : "s"} · pays this sale only
                </p>
                <p className="font-mono text-xs break-all mt-2 text-muted">{payUrl}</p>
                <div className="mt-2">
                  <ShareButton url={payUrl} title={`Pay ${seller.storeName}`} />
                </div>
                <p className="text-xs text-muted mt-2">
                  Expires {WALKUP_TTL_MINUTES} minutes after it was created.
                </p>
              </div>
            </div>
          </div>
        )}

        <WalkUpStatus
          saleId={sale.id}
          initialState={
            state === "open"
              ? "waiting"
              : state === "canceled"
                ? "canceled"
                : state === "expired"
                  ? "expired"
                  : "customer_paying"
          }
          totalCents={total}
          itemCount={count}
          dropHref={dropHref}
          newSaleHref={`${dropHref}/sale`}
        />
      </div>
    );
  }
}
