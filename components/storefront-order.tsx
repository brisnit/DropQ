"use client";

import { useActionState, useState } from "react";
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
  remaining: number;
};

function PlaceButton({
  total,
  count,
  accent,
  paymentsEnabled,
}: {
  total: number;
  count: number;
  accent: string;
  paymentsEnabled: boolean;
}) {
  const { pending } = useFormStatus();
  const idle = paymentsEnabled ? "Continue to payment" : "Place order";
  const busy = paymentsEnabled ? "Redirecting…" : "Placing order…";
  return (
    <button
      type="submit"
      disabled={pending || count === 0}
      style={{ backgroundColor: accent }}
      className="w-full text-white font-semibold rounded-xl py-3.5 flex items-center justify-between px-5 disabled:opacity-50 transition active:scale-[0.99]"
    >
      <span>{pending ? busy : count === 0 ? "Add items to order" : idle}</span>
      {count > 0 && <span>{formatMoney(total)}</span>}
    </button>
  );
}

export function StorefrontOrder({
  dropId,
  products,
  accent,
  paymentsEnabled,
  feeMode = "absorb",
  feePercent = 0,
}: {
  dropId: string;
  products: Product[];
  accent: string;
  paymentsEnabled: boolean;
  feeMode?: string;
  feePercent?: number;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [state, formAction] = useActionState<OrderState, FormData>(placeOrderAction, {});

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

  return (
    <form action={formAction} className="grid lg:grid-cols-[1fr_360px] gap-8 items-start">
      <input type="hidden" name="dropId" value={dropId} />
      {products.map((p) => (
        <input key={p.id} type="hidden" name={`qty_${p.id}`} value={qty[p.id] ?? 0} />
      ))}

      {/* Menu */}
      <div className="space-y-3">
        {products.map((p) => {
          const n = qty[p.id] ?? 0;
          const soldOut = p.remaining <= 0;
          return (
            <div
              key={p.id}
              className={`bg-paper border rounded-card p-3 sm:p-4 flex items-center gap-4 ${
                soldOut ? "border-line opacity-60" : "border-line"
              }`}
            >
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.imageUrl}
                  alt={p.name}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl object-cover shrink-0 border border-line"
                />
              ) : (
                <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-cream grid place-items-center text-3xl shrink-0">
                  {p.emoji}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium">{p.name}</p>
                {p.description && <p className="text-sm text-muted">{p.description}</p>}
                <p className="text-sm mt-0.5">
                  <span className="font-semibold">{formatMoney(p.priceCents)}</span>
                  {!soldOut && p.remaining <= 8 && (
                    <span className="text-brand ml-2">{p.remaining} left</span>
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
                  onClick={() => setItem(p.id, 1, p.remaining)}
                  style={{ color: accent, borderColor: accent }}
                  className="shrink-0 text-sm font-semibold border rounded-pill px-4 py-1.5 hover:bg-cream transition"
                >
                  Add
                </button>
              ) : (
                <div className="shrink-0 flex items-center gap-3 border border-line-strong rounded-pill px-1.5 py-1">
                  <button
                    type="button"
                    onClick={() => setItem(p.id, n - 1, p.remaining)}
                    className="w-7 h-7 rounded-full hover:bg-line grid place-items-center text-lg"
                    aria-label="Decrease"
                  >
                    −
                  </button>
                  <span className="w-5 text-center font-semibold text-sm">{n}</span>
                  <button
                    type="button"
                    onClick={() => setItem(p.id, n + 1, p.remaining)}
                    disabled={n >= p.remaining}
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

        <PlaceButton total={total} count={count} accent={accent} paymentsEnabled={paymentsEnabled} />
        <p className="text-xs text-muted text-center">
          {paymentsEnabled
            ? "🔒 Secure checkout powered by Stripe."
            : "Demo checkout — no real payment is taken."}
        </p>
      </div>
    </form>
  );
}
