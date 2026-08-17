"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/format";
import { startWalkUpSaleAction } from "@/lib/actions/walkup";
import { Button } from "@/components/ui";

/**
 * The vendor's walk-up cart (Phase D).
 *
 * Optimised for someone standing at a booth with a customer waiting: big
 * quantity controls, a running total, one action. Deliberately not a POS —
 * no discounts, notes, custom lines or split tender.
 *
 * It submits quantities only. Prices are never sent; the server reads them from
 * `Product` (see lib/walkup.ts). Nothing here is authorization — the server
 * action re-checks the flag, ownership and `canStartInPersonSale()`.
 */

export type WalkUpProduct = {
  id: string;
  name: string;
  priceCents: number;
  remaining: number;
};

function StartButton({ count, total }: { count: number; total: number }) {
  const { pending } = useFormStatus();
  // Disabling while pending is the double-click guard. A duplicate cart would
  // be harmless anyway — it reserves nothing and expires in 30 minutes — but
  // there is no reason to create one.
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending ? "Starting…" : count === 0 ? "Add an item" : `Start sale · ${formatMoney(total)}`}
    </Button>
  );
}

export function WalkUpCart({
  dropId,
  products,
  onCancel,
}: {
  dropId: string;
  products: WalkUpProduct[];
  onCancel: () => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const get = (id: string) => qty[id] ?? 0;
  const set = (id: string, n: number, max: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(n, max)) }));

  const count = products.reduce((n, p) => n + get(p.id), 0);
  const total = products.reduce((s, p) => s + p.priceCents * get(p.id), 0);

  return (
    <form action={startWalkUpSaleAction}>
      <input type="hidden" name="dropId" value={dropId} />
      <div className="space-y-1">
        {products.map((p) => {
          const n = get(p.id);
          const out = p.remaining <= 0;
          return (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-b-0"
            >
              <div className="min-w-0">
                <p className={`font-medium truncate ${out ? "text-muted" : ""}`}>{p.name}</p>
                <p className="text-xs text-muted">
                  {formatMoney(p.priceCents)} · {out ? "sold out" : `${p.remaining} left`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input type="hidden" name={`qty_${p.id}`} value={n} />
                <button
                  type="button"
                  aria-label={`Remove one ${p.name}`}
                  onClick={() => set(p.id, n - 1, p.remaining)}
                  disabled={n === 0}
                  className="w-12 h-12 rounded-xl border border-line-strong bg-paper text-2xl leading-none disabled:opacity-40 active:scale-95 transition"
                >
                  −
                </button>
                <span className="w-8 text-center tabular-nums font-semibold text-lg">{n}</span>
                <button
                  type="button"
                  aria-label={`Add one ${p.name}`}
                  onClick={() => set(p.id, n + 1, p.remaining)}
                  disabled={out || n >= p.remaining}
                  className="w-12 h-12 rounded-xl border border-line-strong bg-paper text-2xl leading-none disabled:opacity-40 active:scale-95 transition"
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-line-strong">
        <p className="font-semibold">
          Total <span className="tabular-nums">{formatMoney(total)}</span>
          {count > 0 && (
            <span className="text-muted font-normal"> · {count} item{count === 1 ? "" : "s"}</span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            Cancel
          </button>
          <StartButton count={count} total={total} />
        </div>
      </div>
    </form>
  );
}

/**
 * The cart as it appears on the focused sale route. Identical controls; Cancel
 * leaves the flow rather than collapsing a panel, because on that route there
 * is nothing to collapse back into.
 */
export function WalkUpCartScreen({
  dropId,
  products,
  cancelHref,
}: {
  dropId: string;
  products: WalkUpProduct[];
  cancelHref: string;
}) {
  const router = useRouter();
  return (
    <div className="bg-paper border border-line rounded-card p-4 sm:p-5">
      <WalkUpCart dropId={dropId} products={products} onCancel={() => router.push(cancelHref)} />
    </div>
  );
}

/* --------------------------- Live status (Phase E) ------------------------- */

type StatusPayload = {
  state: "waiting" | "customer_paying" | "paid" | "refunded" | "expired" | "canceled";
  orderId: string | null;
  totalCents: number | null;
  done: boolean;
};

const LABEL: Record<StatusPayload["state"], { text: string; cls: string }> = {
  // "…to scan" so the pre-scan state is unambiguous: nothing has happened yet
  // and this QR is the thing the customer still has to act on.
  waiting: { text: "Waiting for the customer to scan…", cls: "bg-line text-ink-soft" },
  customer_paying: { text: "Customer is paying…", cls: "bg-quad/15 text-tertiary" },
  paid: { text: "✓ Paid", cls: "bg-sage-tint text-sage" },
  refunded: { text: "Sold out — refunded", cls: "bg-brand-tint text-brand-dark" },
  expired: { text: "Expired", cls: "bg-line text-muted" },
  canceled: { text: "Canceled", cls: "bg-line text-muted" },
};

/**
 * Polls the seller-owned status endpoint every 3s, the same pattern
 * `components/live-orders.tsx` already uses.
 *
 * ⚠️ "Paid" comes from `Order.paymentStatus`, which only `finalizePaidOrder`
 * sets — never from the customer returning from Stripe. In the oversell case
 * the charge succeeds and the order is then canceled and refunded, so a
 * redirect-based "Paid" would tell the vendor to hand over goods they no
 * longer have.
 */
export function WalkUpStatus({
  saleId,
  initialState,
  totalCents,
  itemCount,
  dropHref,
  newSaleHref,
}: {
  saleId: string;
  initialState: StatusPayload["state"];
  /** Supplied by the focused sale route so Paid can render a full success panel. */
  totalCents?: number;
  itemCount?: number;
  dropHref?: string;
  newSaleHref?: string;
}) {
  const [status, setStatus] = useState<StatusPayload["state"]>(initialState);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const res = await fetch(`/api/walkup/${saleId}/status`, { cache: "no-store" });
        if (!res.ok || !active) return;
        const d = (await res.json()) as StatusPayload;
        setStatus(d.state);
        setOrderId(d.orderId);
        if (d.done && timer) clearInterval(timer);
      } catch {
        /* transient — keep polling */
      }
    };
    timer = setInterval(poll, 3000);
    void poll();
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [saleId]);

  const l = LABEL[status];

  // Paid is the moment the vendor hands over goods, so it gets a full panel
  // rather than a chip they have to hunt for.
  if (status === "paid" && dropHref) {
    return (
      <div className="rounded-card border-2 border-sage bg-sage-tint/60 p-5 sm:p-6 text-center">
        <p className="text-4xl" aria-hidden>✓</p>
        <p className="font-display text-2xl font-semibold mt-1">Paid</p>
        {totalCents != null && (
          <p className="font-display text-3xl font-semibold tabular-nums mt-2">
            {formatMoney(totalCents)}
          </p>
        )}
        {itemCount != null && (
          <p className="text-sm text-muted mt-1">
            {itemCount} item{itemCount === 1 ? "" : "s"} · hand over the order
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 justify-center mt-5">
          <a
            href={dropHref}
            className="text-sm font-semibold px-5 py-3 rounded-xl bg-ink text-cream hover:bg-ink-soft transition"
          >
            Done
          </a>
          {newSaleHref && (
            <a
              href={newSaleHref}
              className="text-sm font-semibold px-5 py-3 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
            >
              New in-person sale
            </a>
          )}
        </div>
        {orderId && (
          <a href="/dashboard/orders" className="block text-sm font-medium underline mt-4">
            See the order
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-pill ${l.cls}`}>
        {status === "waiting" || status === "customer_paying" ? (
          <span className="w-1.5 h-1.5 rounded-full bg-current live-dot" />
        ) : null}
        {l.text}
      </span>
      {status === "paid" && orderId && (
        <a href={`/dashboard/orders`} className="text-sm font-medium underline">
          See the order
        </a>
      )}
    </div>
  );
}
