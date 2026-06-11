"use client";

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
  return (
    <form action={action}>
      <input type="hidden" name="orderId" value={orderId} />
      <select
        name="status"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
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
