"use client";

import { useState } from "react";

const ORDER_STATUSES = ["new", "ready", "fulfilled", "canceled"];

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
        className="text-xs font-semibold rounded-lg border border-line-strong bg-paper px-2 py-1.5 capitalize focus:outline-none focus:border-brand cursor-pointer"
      >
        {ORDER_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </form>
  );
}
