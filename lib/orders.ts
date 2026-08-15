// Centralized order-status vocabulary so every surface (dashboard, admin,
// analytics, status picker) agrees. Legacy "fulfilled" maps to "Completed".

export const ORDER_STATUSES = [
  "new",
  "in_progress",
  "ready",
  "completed",
  "canceled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that count as a real (placed, non-pending, non-canceled) order. */
export const PAID_STATUSES = ["new", "in_progress", "ready", "completed", "fulfilled"];

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  new: "New",
  in_progress: "In Progress",
  ready: "Ready",
  completed: "Completed",
  fulfilled: "Completed", // legacy
  canceled: "Canceled",
};

export function orderStatusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

export const ORDER_STATUS_STYLE: Record<string, string> = {
  pending: "bg-line text-muted",
  new: "bg-grey-tint text-[#3f434b]",
  in_progress: "bg-quad/15 text-tertiary",
  ready: "bg-sage-tint text-sage",
  completed: "bg-line text-muted",
  fulfilled: "bg-line text-muted",
  canceled: "bg-brand-tint text-brand-dark",
};

export function orderStatusStyle(s: string): string {
  return ORDER_STATUS_STYLE[s] ?? "bg-line text-ink-soft";
}

// Payment states. "unpaid" used to render as "Pay in person", which was
// misleading: it describes an order nobody has paid for, not an agreed payment
// arrangement. DropQ takes card payment through Stripe — there is no
// pay-in-person option. refunded / refund_pending / expired are all written by
// lib/checkout.ts and previously fell through to the raw string.
export function paymentLabel(p: string): string {
  return (
    {
      paid: "Paid",
      unpaid: "Unpaid",
      pending: "Awaiting payment",
      refund_pending: "Refund pending",
      refunded: "Refunded",
      expired: "Expired",
    }[p] ?? p
  );
}

export function paymentStyle(p: string): string {
  return (
    {
      paid: "bg-sage-tint text-sage",
      unpaid: "bg-quad/15 text-tertiary",
      pending: "bg-line text-muted",
      refund_pending: "bg-line text-muted",
      refunded: "bg-brand-tint text-brand-dark",
      expired: "bg-line text-muted",
    }[p] ?? "bg-line text-muted"
  );
}
