"use client";

import { useState } from "react";
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
  // Controlled value so React 19's post-action form reset doesn't snap an
  // uncontrolled <select> back to its default ("new"). The user's choice sticks.
  const [status, setStatus] = useState(value);

  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <select
        name="status"
        value={status}
        onChange={(e) => {
          setStatus(e.target.value);
          e.currentTarget.form?.requestSubmit();
        }}
        className="text-xs font-semibold rounded-lg border border-line-strong bg-paper px-2 py-1.5 focus:outline-none focus:border-brand cursor-pointer"
      >
        {/* Legacy 'fulfilled' orders still display correctly via the label map. */}
        {!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number]) && (
          <option value={status}>{orderStatusLabel(status)}</option>
        )}
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {orderStatusLabel(s)}
          </option>
        ))}
      </select>
    </form>
  );
}
