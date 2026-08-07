import { messageCustomerFromOrderAction, messageCustomerByEmailAction } from "@/lib/actions/messages";

/**
 * Contextual "Message Customer" action. Dropped anywhere a vendor already sees
 * an order — order lists, live drop view, fulfillment — it opens (or reuses)
 * the conversation with that buyer, carries the order + drop context along, and
 * lands the vendor straight in the thread.
 */
export function MessageCustomerButton({
  orderId,
  email,
  label = "Message",
  variant = "compact",
}: {
  /** Preferred: preserves order + drop context. */
  orderId?: string;
  /** Fallback for surfaces with no specific order (the Customers list). */
  email?: string;
  label?: string;
  variant?: "compact" | "full";
}) {
  const action = orderId ? messageCustomerFromOrderAction : messageCustomerByEmailAction;

  const className =
    variant === "full"
      ? "inline-flex items-center justify-center gap-1.5 w-full min-h-[44px] px-4 rounded-xl bg-ink text-cream text-sm font-semibold transition active:scale-[0.98] hover:bg-ink-soft"
      : "inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-pill border border-line-strong bg-paper text-sm font-medium text-ink-soft hover:border-ink/30 hover:text-ink transition";

  return (
    <form action={action} className={variant === "full" ? "w-full" : undefined}>
      {orderId ? (
        <input type="hidden" name="orderId" value={orderId} />
      ) : (
        <input type="hidden" name="email" value={email ?? ""} />
      )}
      <button type="submit" className={className}>
        <span aria-hidden>💬</span>
        {label}
      </button>
    </form>
  );
}
