"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney, relativeTime } from "@/lib/format";
import {
  orderStatusLabel,
  orderStatusStyle,
  paymentLabel,
  paymentStyle,
} from "@/lib/orders";
import { updateOrderStatusAction } from "@/lib/actions/dashboard";
import { StatusSelect } from "@/components/status-select";

export type LiveOrder = {
  id: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string | null;
  note: string | null;
  status: string;
  paymentStatus: string;
  source: string;
  totalCents: number;
  createdAt: string;
  items: { id: string; name: string; quantity: number }[];
};

const POLL_MS = 5000;

export function LiveOrders({
  dropId,
  initialOrders,
}: {
  dropId: string;
  initialOrders: LiveOrder[];
}) {
  const [orders, setOrders] = useState<LiveOrder[]>(initialOrders);
  const [live, setLive] = useState(true);
  const prevIds = useRef<Set<string>>(new Set(initialOrders.map((o) => o.id)));
  const [newCount, setNewCount] = useState(0);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/drops/${dropId}/orders`, { cache: "no-store" });
        if (!res.ok) {
          if (active) setLive(false);
          return;
        }
        const data = (await res.json()) as { orders: LiveOrder[] };
        if (!active) return;
        setLive(true);
        // Count freshly-arrived orders since the last poll.
        const fresh = data.orders.filter((o) => !prevIds.current.has(o.id));
        if (fresh.length) setNewCount((n) => n + fresh.length);
        prevIds.current = new Set(data.orders.map((o) => o.id));
        setOrders(data.orders);
      } catch {
        if (active) setLive(false);
      }
    };
    const t = setInterval(poll, POLL_MS);
    poll();
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [dropId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          Live orders ({orders.length})
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-pill ${
              live ? "bg-sage-tint text-sage" : "bg-line text-muted"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-sage live-dot" : "bg-muted"}`} />
            {live ? "Live" : "Reconnecting…"}
          </span>
        </h2>
        {newCount > 0 && (
          <button
            onClick={() => setNewCount(0)}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {newCount} new — got it
          </button>
        )}
      </div>

      {orders.length === 0 ? (
        <div className="bg-paper border border-dashed border-line-strong rounded-card p-8 text-center text-muted">
          Waiting for the first order… Customers scan your QR and order from their phone — new orders pop up here automatically.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="bg-paper border border-line rounded-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{o.buyerName}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-semibold uppercase tracking-wide ${orderStatusStyle(o.status)}`}>
                      {orderStatusLabel(o.status)}
                    </span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-semibold uppercase tracking-wide ${paymentStyle(o.paymentStatus)}`}>
                      {paymentLabel(o.paymentStatus)}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-0.5">
                    {o.buyerPhone ? `${o.buyerPhone} · ` : ""}
                    {o.buyerEmail} · {relativeTime(new Date(o.createdAt))}
                  </p>
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
    </div>
  );
}
