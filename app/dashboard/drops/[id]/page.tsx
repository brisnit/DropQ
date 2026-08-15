import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  updateDropStatusAction,
  deleteDropAction,
  updateOrderStatusAction,
  duplicateDropAction,
  vendorArrivedAction,
} from "@/lib/actions/dashboard";
import { formatMoney, formatDateTime, relativeTime, statusStyle } from "@/lib/format";
import { vocab, showItemMeta } from "@/lib/category";
import { Section } from "@/components/dashboard-ui";
import { Badge, Button } from "@/components/ui";
import { ShareButton } from "@/components/share-button";
import { StatusSelect } from "@/components/status-select";
import { LiveOrders } from "@/components/live-orders";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { Countdown } from "@/components/countdown";
import { computeDropPhase } from "@/lib/drop-status";
import { formatPickupWindow, pickupLocation } from "@/lib/pickup";
import { BackLink } from "@/components/back-link";
import { StripeRequiredBanner } from "@/components/stripe-required-banner";
import { loadActivationState, publishGate } from "@/lib/activation";
import { DropCommunicationSection } from "@/components/drop-communication";
import { MessageCustomerButton } from "@/components/message-customer-button";
import { dropCommunicationSummary } from "@/lib/messaging";

export default async function DropDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stripe_required?: string }>;
}) {
  const { id } = await params;
  const { stripe_required: stripeRequired } = await searchParams;
  const seller = await requireSeller();

  // Publish gate (V.3). UX only — updateDropStatusAction still routes every
  // status change through resolveDropStatus, so a forged form is still refused.
  const gate = publishGate(await loadActivationState(seller));

  const drop = await prisma.drop.findUnique({
    where: { id },
    include: {
      products: { orderBy: { sortOrder: "asc" } },
      orders: {
        where: { status: { not: "pending" } },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      },
    },
  });
  if (!drop || drop.sellerId !== seller.id) notFound();

  const h = await headers();
  const host = h.get("host") ?? "localhost:3001";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const shareUrl = `${proto}://${host}/s/${seller.slug}/${drop.id}`;
  const qrDataUrl = await QRCode.toDataURL(shareUrl, {
    width: 360,
    margin: 1,
    color: { dark: "#1b1726", light: "#ffffff" },
  });

  const revenue = drop.orders.reduce((s, o) => s + o.totalCents, 0);
  const sold = drop.products.reduce((s, p) => s + p.sold, 0);
  const stock = drop.products.reduce((s, p) => s + p.inventory, 0);

  const communication = await dropCommunicationSummary(seller.id, drop.id);

  const v = vocab(seller.category);
  const meta = showItemMeta(seller.category);
  const isLiveDrop = drop.mode === "live";
  const liveOrders = drop.orders.map((o) => ({
    id: o.id,
    buyerName: o.buyerName,
    buyerEmail: o.buyerEmail,
    buyerPhone: o.buyerPhone,
    note: o.note,
    status: o.status,
    paymentStatus: o.paymentStatus,
    source: o.source,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    items: o.items.map((it) => ({ id: it.id, name: it.name, quantity: it.quantity })),
  }));

  return (
    <Section>
      {/* Exactly one Stripe message on this page, at the point of action. The
          transient post-blocked-publish notice wins; otherwise the inline
          publish gate; otherwise the generic banner (which renders nothing for
          a charge-ready vendor anyway). */}
      {stripeRequired && gate ? (
        <div className="mb-6 rounded-card bg-brand-tint border border-brand/40 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-brand-dark max-w-xl">
            <b>Saved as a draft.</b> {gate.reason} Everything you entered has been kept.
          </p>
          <Link
            href={gate.href}
            className="shrink-0 text-sm font-medium px-3.5 py-2 rounded-lg bg-ink text-cream hover:bg-ink-soft transition"
          >
            {gate.cta} →
          </Link>
        </div>
      ) : gate ? (
        <div className="mb-6 rounded-card bg-quad/10 border border-quad/30 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft max-w-xl">{gate.reason}</p>
          <Link
            href={gate.href}
            className="shrink-0 text-sm font-medium px-3.5 py-2 rounded-lg border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            {gate.cta} →
          </Link>
        </div>
      ) : (
        <StripeRequiredBanner seller={seller} />
      )}
      <BackLink href="/dashboard/drops">Back to drops</BackLink>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mt-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              {drop.title}
            </h1>
            <Badge className={statusStyle(drop.status)}>{drop.status}</Badge>
            <Badge className={isLiveDrop ? "bg-quad/15 text-tertiary" : "bg-line text-ink-soft"}>
              {isLiveDrop ? "🟢 Live selling" : "Preorder drop"}
            </Badge>
          </div>
          {drop.pickupInfo && <p className="text-muted mt-1">{drop.fulfillment} · {drop.pickupInfo}</p>}
        </div>

        <div className="flex items-center gap-2">
          {drop.status === "draft" &&
            (gate ? (
              <Link
                href={gate.href}
                className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition whitespace-nowrap"
              >
                {gate.cta} to publish →
              </Link>
            ) : (
              <form action={updateDropStatusAction}>
                <input type="hidden" name="dropId" value={drop.id} />
                <input type="hidden" name="status" value="live" />
                <Button type="submit">Publish drop</Button>
              </form>
            ))}
          {drop.status === "live" && (
            <form action={updateDropStatusAction}>
              <input type="hidden" name="dropId" value={drop.id} />
              <input type="hidden" name="status" value="closed" />
              <Button type="submit" variant="secondary">Close drop</Button>
            </form>
          )}
          {drop.status === "closed" &&
            (gate ? (
              <Link
                href={gate.href}
                className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition whitespace-nowrap"
              >
                {gate.cta} to reopen →
              </Link>
            ) : (
              <form action={updateDropStatusAction}>
                <input type="hidden" name="dropId" value={drop.id} />
                <input type="hidden" name="status" value="live" />
                <Button type="submit" variant="secondary">Reopen</Button>
              </form>
            ))}
          <Link
            href={`/dashboard/drops/${drop.id}/edit`}
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            ✏️ Edit drop
          </Link>
          <form action={duplicateDropAction}>
            <input type="hidden" name="dropId" value={drop.id} />
            <button
              type="submit"
              className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
              title="Copy this drop's items and pickup details into a new draft"
            >
              🔁 Relaunch
            </button>
          </form>
          <Link
            href={`/s/${seller.slug}/${drop.id}`}
            target="_blank"
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            View ↗
          </Link>
        </div>
      </div>

      {/* Order window + pickup (preorder drops) */}
      {!isLiveDrop && (() => {
        const tz = seller.timezone || undefined;
        const fmt = (d: Date | null) =>
          d ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(d) : null;
        const phase = computeDropPhase(drop);
        const pickupWin = formatPickupWindow(drop, tz);
        const pickupWhere = pickupLocation(drop);
        return (
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <div className="bg-paper border border-line rounded-card p-5">
              <p className="text-xs uppercase tracking-wide text-muted">Order window</p>
              {drop.opensAt && drop.closesAt ? (
                <>
                  <p className="text-sm mt-1">{fmt(drop.opensAt)} <span className="text-muted">→</span> {fmt(drop.closesAt)}</p>
                  <p className="mt-2 text-sm">
                    {phase === "open" ? (
                      <>Ordering closes in <Countdown to={drop.closesAt.toISOString()} /></>
                    ) : phase === "scheduled" ? (
                      <span className="text-muted">Scheduled — hasn&rsquo;t opened yet</span>
                    ) : (
                      <span className="text-muted">Ordering closed</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted mt-1">No order window set.</p>
              )}
              <p className="text-sm mt-3">
                <span className="font-semibold">{drop.orders.length}</span> order{drop.orders.length !== 1 ? "s" : ""} locked in
              </p>
            </div>
            <div className="bg-paper border border-line rounded-card p-5">
              <p className="text-xs uppercase tracking-wide text-muted">Pickup</p>
              {pickupWin && <p className="text-sm mt-1"><span className="font-medium">When:</span> {pickupWin}</p>}
              {pickupWhere && <p className="text-sm mt-0.5"><span className="font-medium">Where:</span> {pickupWhere}</p>}
              {drop.pickupNotes && <p className="text-sm mt-0.5 text-ink-soft"><span className="font-medium">Notes:</span> {drop.pickupNotes}</p>}
              {!pickupWin && !pickupWhere && !drop.pickupNotes && (
                <p className="text-sm text-muted mt-1">
                  No pickup details yet.{" "}
                  <Link href={`/dashboard/drops/${drop.id}/edit`} className="text-brand hover:underline">Add them</Link>.
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Vendor check-in — tell waiting customers you've arrived at pickup */}
      {drop.status !== "draft" && drop.orders.length > 0 && (
        <div className="mb-8 bg-paper border border-line rounded-card p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="font-semibold">
              {drop.vendorArrivedAt ? "You're checked in 📍" : "At the pickup spot?"}
            </p>
            <p className="text-sm text-muted mt-0.5">
              {drop.vendorArrivedAt
                ? `Customers were notified you've arrived — ${formatDateTime(drop.vendorArrivedAt)}.`
                : "Let everyone with an order know you've arrived and are ready for pickup."}
            </p>
          </div>
          {!drop.vendorArrivedAt && (
            <form action={vendorArrivedAction}>
              <input type="hidden" name="dropId" value={drop.id} />
              <Button type="submit">📍 I&apos;m at the pickup location</Button>
            </form>
          )}
        </div>
      )}

      {/* Share + QR (always visible) */}
      <div className="grid md:grid-cols-[1fr_auto] gap-4 mb-8 items-stretch">
        <div className="bg-ink text-cream rounded-card p-5 flex flex-col justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-cream/60">
              {isLiveDrop ? "Live order link — show this QR on-site" : "Share this drop"}
            </p>
            <p className="font-mono text-sm break-all mt-1">{shareUrl}</p>
          </div>
          <ShareButton
            url={shareUrl}
            title={drop.title}
            label="Copy link"
            className="self-start text-sm font-semibold text-ink bg-cream hover:bg-white px-4 py-2.5 rounded-lg transition"
          />
        </div>

        <div className="bg-paper border border-line rounded-card p-5 flex flex-col items-center gap-3 text-center">
          <p className="text-xs uppercase tracking-wider text-muted">
            {isLiveDrop ? "Live order QR" : "Drop QR"}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt={isLiveDrop ? "QR code for live on-site orders" : "QR code linking to this drop"}
            width={132}
            height={132}
            className="rounded-xl border border-line"
          />
          <a
            href={qrDataUrl}
            download={`dropq-${seller.slug}-${drop.id}.png`}
            className="text-sm font-medium px-3.5 py-2 rounded-lg border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            ↓ Download QR
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-paper border border-line rounded-card p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Revenue</p>
          <p className="font-display text-2xl font-semibold mt-1">{formatMoney(revenue)}</p>
        </div>
        <div className="bg-paper border border-line rounded-card p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Orders</p>
          <p className="font-display text-2xl font-semibold mt-1">{drop.orders.length}</p>
        </div>
        <div className="bg-paper border border-line rounded-card p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Sold</p>
          <p className="font-display text-2xl font-semibold mt-1">{sold}/{stock}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Items */}
        <div className="lg:col-span-2">
          <h2 className="font-semibold mb-3">{v.catalog} ({drop.products.length})</h2>
          <div className="bg-paper border border-line rounded-card divide-y divide-line">
            {drop.products.map((p) => {
              const pct = p.inventory ? Math.round((p.sold / p.inventory) * 100) : 0;
              const out = p.inventory > 0 && p.sold >= p.inventory;
              return (
                <div key={p.id} className="p-4">
                  <div className="flex items-center gap-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt={p.name} className="w-11 h-11 rounded-lg object-cover border border-line shrink-0" />
                    ) : (
                      <span className="w-11 h-11 rounded-lg bg-cream grid place-items-center text-xl shrink-0">{p.emoji}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{p.name}</p>
                      {p.description && <p className="text-xs text-muted truncate">{p.description}</p>}
                      {meta && (p.productType || p.condition || p.rarity) && (
                        <p className="text-[11px] text-muted truncate">
                          {[p.productType, p.condition, p.rarity].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <span className="font-semibold">{formatMoney(p.priceCents)}</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="h-1.5 flex-1 rounded-full bg-line overflow-hidden">
                      <div className={`h-full rounded-full ${out ? "bg-brand" : "bg-sage"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <span className="text-xs text-muted shrink-0">
                      {out ? "Sold out" : `${p.sold}/${p.inventory}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Customer Communication — launchpad into Messages for this drop */}
        <div className="lg:col-span-3">
          <DropCommunicationSection dropId={drop.id} data={communication} />
        </div>

        {/* Orders — live polling feed for live drops, static list otherwise */}
        <div className="lg:col-span-3">
          {isLiveDrop ? (
            <LiveOrders dropId={drop.id} initialOrders={liveOrders} />
          ) : (
            <>
              <h2 className="font-semibold mb-3">Orders ({drop.orders.length})</h2>
              {drop.orders.length === 0 ? (
                <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted">
                  No orders yet. Share your link to start selling.
                </div>
              ) : (
                <div className="space-y-3">
                  {drop.orders.map((o) => (
                    <div key={o.id} className="bg-paper border border-line rounded-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium flex items-center gap-2">
                            {o.buyerName}
                            {o.customerArrivedAt && (
                              <Badge className="bg-sage-tint text-sage">📍 Arrived</Badge>
                            )}
                          </p>
                          <p className="text-xs text-muted">
                            {o.buyerEmail}
                            {o.buyerPhone ? ` · ${o.buyerPhone}` : ""} · {relativeTime(o.createdAt)}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <MessageCustomerButton orderId={o.id} label="Message" />
                            {o.buyerPhone && (
                              <>
                                <a
                                  href={`tel:${o.buyerPhone}`}
                                  className="inline-flex items-center min-h-[38px] px-3 rounded-pill border border-line-strong bg-paper text-sm font-medium hover:border-ink/30 transition"
                                >
                                  📞 Call
                                </a>
                                <a
                                  href={`sms:${o.buyerPhone}`}
                                  className="inline-flex items-center min-h-[38px] px-3 rounded-pill border border-line-strong bg-paper text-sm font-medium hover:border-ink/30 transition"
                                >
                                  💬 Text
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-semibold">{formatMoney(o.totalCents)}</span>
                          <StatusSelect action={updateOrderStatusAction} orderId={o.id} value={o.status} />
                        </div>
                      </div>
                      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                        {o.items.map((it) => (
                          <li key={it.id}>
                            <span className="text-muted">{it.quantity}×</span> {it.name}
                          </li>
                        ))}
                      </ul>
                      {o.note && <p className="mt-2 text-sm text-muted italic">“{o.note}”</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Danger zone */}
      <div className="mt-10 pt-6 border-t border-line flex items-center justify-between">
        <p className="text-sm text-muted">Created {formatDateTime(drop.createdAt)}</p>
        <form action={deleteDropAction}>
          <input type="hidden" name="dropId" value={drop.id} />
          <ConfirmSubmit
            message="Delete this drop and all its orders? This can't be undone."
            className="text-sm text-muted hover:text-brand transition"
          >
            Delete drop
          </ConfirmSubmit>
        </form>
      </div>
    </Section>
  );
}
