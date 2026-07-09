"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/format";
import { placeOrderAction, type OrderState } from "@/lib/actions/order";

type Product = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  emoji: string;
  imageUrl: string | null;
  images: string[];
  remaining: number;
  productType?: string | null;
  condition?: string | null;
  rarity?: string | null;
};

function SubmitBtn({
  label,
  busy,
  count,
  total,
  accent,
  outline = false,
  payInPerson = false,
}: {
  label: string;
  busy: string;
  count: number;
  total: number;
  accent: string;
  outline?: boolean;
  payInPerson?: boolean;
}) {
  const { pending } = useFormStatus();
  const disabled = pending || count === 0;
  const extra = payInPerson ? { name: "payInPerson", value: "1" } : {};
  if (outline) {
    return (
      <button
        type="submit"
        {...extra}
        disabled={disabled}
        style={{ borderColor: accent, color: accent }}
        className="w-full font-semibold rounded-xl py-3 border-2 bg-paper disabled:opacity-50 transition active:scale-[0.99]"
      >
        {pending ? busy : count === 0 ? "Add items first" : label}
      </button>
    );
  }
  return (
    <button
      type="submit"
      {...extra}
      disabled={disabled}
      style={{ backgroundColor: accent }}
      className="w-full text-white font-semibold rounded-xl py-3.5 flex items-center justify-between px-5 disabled:opacity-50 transition active:scale-[0.99]"
    >
      <span>{pending ? busy : count === 0 ? "Add items to order" : label}</span>
      {count > 0 && <span>{formatMoney(total)}</span>}
    </button>
  );
}

function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m ${sec}s`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

export function StorefrontOrder({
  dropId,
  products,
  accent,
  paymentsEnabled,
  feeMode = "absorb",
  feePercent = 0,
  live = false,
  closesAt = null,
}: {
  dropId: string;
  products: Product[];
  accent: string;
  paymentsEnabled: boolean;
  feeMode?: string;
  feePercent?: number;
  live?: boolean;
  closesAt?: string | null;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [state, formAction] = useActionState<OrderState, FormData>(placeOrderAction, {});
  // Lightbox: which product's photos are open, and the active photo index.
  const [zoom, setZoom] = useState<{ images: string[]; name: string; index: number } | null>(null);

  // Live inventory. Seeded from the server render, then kept fresh by polling so
  // an open tab flips items to "Sold out" without a manual refresh.
  const [remainingById, setRemainingById] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.id, p.remaining])),
  );
  const [serverClosed, setServerClosed] = useState(false);
  const remainingOf = (id: string) => remainingById[id] ?? 0;

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch(`/api/drops/${dropId}/inventory`, { cache: "no-store" });
        if (!r.ok) return;
        const data: { open: boolean; products: { id: string; remaining: number }[] } =
          await r.json();
        if (cancelled) return;
        const next = Object.fromEntries(data.products.map((p) => [p.id, p.remaining]));
        setRemainingById(next);
        setServerClosed(!data.open);
        // Clamp any cart quantities that now exceed what's left.
        setQty((q) => {
          let changed = false;
          const clamped: Record<string, number> = {};
          for (const [id, n] of Object.entries(q)) {
            const max = next[id] ?? 0;
            const v = Math.min(n, max);
            clamped[id] = v;
            if (v !== n) changed = true;
          }
          return changed ? clamped : q;
        });
      } catch {
        // Network blip — keep the last known counts.
      }
    };
    const id = setInterval(refresh, 20000);
    const onVis = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [dropId]);

  const setItem = (id: string, n: number, max: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(n, max)) }));

  const lines = products
    .map((p) => ({ p, n: qty[p.id] ?? 0 }))
    .filter((l) => l.n > 0);
  const subtotal = lines.reduce((s, l) => s + l.p.priceCents * l.n, 0);
  const passFee = feeMode === "pass";
  const feeCents = passFee ? Math.round((subtotal * feePercent) / 100) : 0;
  const total = subtotal + feeCents;
  const count = lines.reduce((s, l) => s + l.n, 0);

  // Live countdown to the order close (preorder drops only). When it hits zero,
  // ordering locks in the UI; the server also rejects late orders.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (live || !closesAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, closesAt]);
  const closeMs = !live && closesAt ? new Date(closesAt).getTime() : null;
  const closed = serverClosed || (closeMs != null && nowMs >= closeMs);
  const countdown = closeMs != null && !closed ? formatRemaining(closeMs - nowMs) : null;

  if (closed) {
    return (
      <div className="bg-paper border border-line rounded-card p-10 text-center">
        <div className="text-4xl">🔒</div>
        <h2 className="font-display text-xl font-semibold mt-3">
          This drop is closed. Orders are now locked in.
        </h2>
        <p className="text-muted mt-2">
          Ordering just ended for this drop. Refresh the page to see pickup details.
        </p>
      </div>
    );
  }

  return (
    <>
    {countdown && (
      <div className="mb-5 rounded-card bg-ink text-cream px-4 py-3 flex items-center justify-between gap-3">
        <span className="text-sm font-medium">This drop is open for orders — ordering closes in</span>
        <span
          className="text-xl font-normal tabular-nums tracking-wide"
          style={{ fontFamily: "var(--font-allerta-stencil), monospace" }}
        >
          {countdown}
        </span>
      </div>
    )}
    <form action={formAction} className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
      <input type="hidden" name="dropId" value={dropId} />
      {products.map((p) => (
        <input key={p.id} type="hidden" name={`qty_${p.id}`} value={qty[p.id] ?? 0} />
      ))}

      {/* Menu */}
      <div className="space-y-3">
        {products.map((p) => {
          const n = qty[p.id] ?? 0;
          const remaining = remainingOf(p.id);
          const soldOut = remaining <= 0;
          return (
            <div
              key={p.id}
              className={`bg-paper border rounded-card p-3 sm:p-4 flex items-center gap-4 ${
                soldOut ? "border-line opacity-60" : "border-line"
              }`}
            >
              {p.images.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setZoom({ images: p.images, name: p.name, index: 0 })}
                  className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-xl shrink-0 overflow-hidden border border-line group/img"
                  aria-label={`View ${p.name} photos`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-ink/0 group-hover/img:bg-ink/25 transition grid place-items-center text-white opacity-0 group-hover/img:opacity-100">
                    <ZoomIcon />
                  </span>
                  {p.images.length > 1 && (
                    <span className="absolute bottom-1 right-1 text-[10px] font-semibold bg-ink/70 text-white rounded-full px-1.5 py-0.5 leading-none">
                      {p.images.length}
                    </span>
                  )}
                </button>
              ) : (
                <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-cream grid place-items-center text-3xl shrink-0">
                  {p.emoji}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium">{p.name}</p>
                {p.description && <p className="text-sm text-muted">{p.description}</p>}
                {(p.productType || p.condition || p.rarity) && (
                  <p className="text-xs text-muted mt-0.5 flex flex-wrap gap-x-1.5">
                    {[p.productType, p.condition, p.rarity].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="text-sm mt-0.5">
                  <span className="font-semibold">{formatMoney(p.priceCents)}</span>
                  {!soldOut && remaining <= 8 && (
                    <span className="text-brand ml-2">{remaining} left</span>
                  )}
                </p>
              </div>
              {soldOut ? (
                <span className="text-xs font-semibold uppercase tracking-wide text-muted shrink-0">
                  Sold out
                </span>
              ) : n === 0 ? (
                <button
                  type="button"
                  onClick={() => setItem(p.id, 1, remaining)}
                  style={{ color: accent, borderColor: accent }}
                  className="shrink-0 text-sm font-semibold border rounded-pill px-4 py-1.5 hover:bg-cream transition"
                >
                  Add
                </button>
              ) : (
                <div className="shrink-0 flex items-center gap-3 border border-line-strong rounded-pill px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => setItem(p.id, n - 1, remaining)}
                    className="w-7 h-7 rounded-full hover:bg-line grid place-items-center text-lg"
                    aria-label="Decrease"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-semibold text-sm">{n}</span>
                  <button
                    type="button"
                    onClick={() => setItem(p.id, n + 1, remaining)}
                    disabled={n >= remaining}
                    className="w-7 h-7 rounded-full hover:bg-line grid place-items-center text-lg disabled:opacity-30"
                    aria-label="Increase"
                  >
                    +
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Checkout panel */}
      <div className="lg:sticky lg:top-6 bg-paper border border-line rounded-card p-5 space-y-4">
        <h3 className="font-semibold">Your order</h3>

        {lines.length === 0 ? (
          <p className="text-sm text-muted">No items yet. Tap “Add” to start your order.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {lines.map((l) => (
              <li key={l.p.id} className="flex justify-between gap-2">
                <span className="truncate">
                  <span className="text-muted">{l.n}×</span> {l.p.name}
                </span>
                <span className="font-medium shrink-0">{formatMoney(l.p.priceCents * l.n)}</span>
              </li>
            ))}
            {passFee && (
              <>
                <li className="flex justify-between text-muted">
                  <span>Subtotal</span>
                  <span>{formatMoney(subtotal)}</span>
                </li>
                <li className="flex justify-between text-muted">
                  <span>Service fee ({feePercent}%)</span>
                  <span>{formatMoney(feeCents)}</span>
                </li>
              </>
            )}
            <li className="flex justify-between border-t border-line pt-2 mt-2 font-semibold">
              <span>Total</span>
              <span>{formatMoney(total)}</span>
            </li>
          </ul>
        )}

        <div className="space-y-3 pt-1">
          <input
            name="buyerName"
            placeholder="Your name"
            required
            className="w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink/40"
          />
          <input
            name="buyerEmail"
            type="email"
            placeholder="Email (for your receipt)"
            required
            className="w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink/40"
          />
          <input
            name="buyerPhone"
            type="tel"
            placeholder="Mobile number (for order texts)"
            required
            className="w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink/40"
          />
          <p className="text-xs text-muted leading-snug">
            We&apos;ll text you order updates (received &amp; ready for pickup). Msg &amp; data
            rates may apply.
          </p>
          <textarea
            name="note"
            placeholder="Notes for the maker (optional)"
            className="w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink/40 resize-y min-h-[60px]"
          />
        </div>

        {state.error && (
          <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
        )}

        {live && paymentsEnabled ? (
          <div className="space-y-2">
            <SubmitBtn label="Pay now" busy="Redirecting…" count={count} total={total} accent={accent} />
            <SubmitBtn label="Pay in person" busy="Placing order…" count={count} total={total} accent={accent} outline payInPerson />
          </div>
        ) : (
          <SubmitBtn
            label={paymentsEnabled ? "Continue to payment" : live ? "Place order — pay in person" : "Place order"}
            busy={paymentsEnabled ? "Redirecting…" : "Placing order…"}
            count={count}
            total={total}
            accent={accent}
          />
        )}
        <p className="text-xs text-muted text-center">
          {paymentsEnabled
            ? live
              ? "🔒 Pay now with Stripe, or pay in person at checkout."
              : "🔒 Secure checkout powered by Stripe."
            : live
              ? "Order now, pay the seller in person."
              : "Demo checkout — no real payment is taken."}
        </p>
      </div>
    </form>
    {zoom && (
      <Lightbox
        images={zoom.images}
        name={zoom.name}
        index={zoom.index}
        onIndex={(i) => setZoom((z) => (z ? { ...z, index: i } : z))}
        onClose={() => setZoom(null)}
      />
    )}
    </>
  );
}

function ZoomIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M21 21l-4-4M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* Full-screen photo viewer with prev/next, a thumbnail strip, and click-to-zoom
   so customers can inspect product photos up close. */
function Lightbox({
  images,
  name,
  index,
  onIndex,
  onClose,
}: {
  images: string[];
  name: string;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [magnified, setMagnified] = useState(false);
  const safe = Math.max(0, Math.min(index, images.length - 1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && safe < images.length - 1) onIndex(safe + 1);
      if (e.key === "ArrowLeft" && safe > 0) onIndex(safe - 1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [safe, images.length, onIndex, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${name} photos`}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white/90 shrink-0">
        <span className="text-sm font-medium truncate">{name}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="w-9 h-9 grid place-items-center rounded-full hover:bg-white/15 text-2xl leading-none"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center px-4 relative">
        {safe > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex(safe - 1); }}
            aria-label="Previous photo"
            className="absolute left-2 sm:left-4 w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={images[safe]}
          alt={`${name} photo ${safe + 1}`}
          onClick={(e) => { e.stopPropagation(); setMagnified((m) => !m); }}
          className={`max-h-full max-w-full object-contain select-none transition-transform duration-200 ${
            magnified ? "scale-150 cursor-zoom-out" : "cursor-zoom-in"
          }`}
        />
        {safe < images.length - 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onIndex(safe + 1); }}
            aria-label="Next photo"
            className="absolute right-2 sm:right-4 w-11 h-11 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl"
          >
            ›
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div
          className="flex gap-2 justify-center px-4 py-4 overflow-x-auto shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => { onIndex(i); setMagnified(false); }}
              className={`w-14 h-14 rounded-lg overflow-hidden border-2 shrink-0 ${
                i === safe ? "border-white" : "border-transparent opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
