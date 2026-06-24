"use client";

import { useOptimistic, useTransition } from "react";
import { ORDER_STATUSES, orderStatusLabel } from "@/lib/orders";

export function StatusSelect({
  action,
  orderId,
  value,
}: {
  action: (formData: FormData) => void | Promise<void>;
  orderId: string;
  value: string;
}) {
  // Optimistic value shows the picked status instantly, then reconciles to the
  // authoritative server value after revalidation (and reverts if the action
  // fails). Calling the action directly (no <form>) avoids React 19's
  // post-action form reset, which was snapping the <select> back to "New".
  const [optimistic, setOptimistic] = useOptimistic<string, string>(
    value,
    (_, next) => next
  );
  const [isPending, startTransition] = useTransition();

  const known = ORDER_STATUSES.includes(
    optimistic as (typeof ORDER_STATUSES)[number]
  );

  return (
    <select
      name="status"
      value={optimistic}
      disabled={isPending}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          setOptimistic(next);
          const fd = new FormData();
          fd.set("orderId", orderId);
          fd.set("status", next);
          await action(fd);
        });
      }}
      className="text-xs font-semibold rounded-lg border border-line-strong bg-paper px-2 py-1.5 focus:outline-none focus:border-brand cursor-pointer disabled:opacity-60"
    >
      {/* Legacy 'fulfilled' orders still display correctly via the label map. */}
      {!known && <option value={optimistic}>{orderStatusLabel(optimistic)}</option>}
      {ORDER_STATUSES.map((s) => (
        <option key={s} value={s}>
          {orderStatusLabel(s)}
        </option>
      ))}
    </select>
  );
}
