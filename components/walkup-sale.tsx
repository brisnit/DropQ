"use client";

import { useState } from "react";
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
                  className="w-10 h-10 rounded-xl border border-line-strong bg-paper text-lg disabled:opacity-40 active:scale-95 transition"
                >
                  −
                </button>
                <span className="w-7 text-center tabular-nums font-semibold">{n}</span>
                <button
                  type="button"
                  aria-label={`Add one ${p.name}`}
                  onClick={() => set(p.id, n + 1, p.remaining)}
                  disabled={out || n >= p.remaining}
                  className="w-10 h-10 rounded-xl border border-line-strong bg-paper text-lg disabled:opacity-40 active:scale-95 transition"
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

/** Wraps the cart so the vendor opens it deliberately rather than always seeing it. */
export function WalkUpSaleStarter({
  dropId,
  products,
}: {
  dropId: string;
  products: WalkUpProduct[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold px-4 py-2.5 rounded-xl bg-ink text-cream hover:bg-ink-soft transition"
      >
        + New in-person sale
      </button>
    );
  }
  return <WalkUpCart dropId={dropId} products={products} onCancel={() => setOpen(false)} />;
}
