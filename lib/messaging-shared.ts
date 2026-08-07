/**
 * Messaging helpers that are safe on both sides of the network boundary.
 * lib/messaging.ts is server-only (it touches Prisma); anything a client
 * component needs — labels, initials, audience names — lives here and is
 * re-exported from there so server code still has one import site.
 */

export const MAX_BODY = 4000;
const PREVIEW_LEN = 140;

export type SenderType = "vendor" | "customer" | "system";
export type MessageType = "text" | "announcement" | "system" | "order_update";

export function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN - 1)}…` : flat;
}

/** Display name for a customer that never falls back to an id. */
export function customerLabel(c: { name?: string | null; email: string }): string {
  return c.name?.trim() || c.email.split("@")[0];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export const AUDIENCES = {
  drop_all: "Everyone in this drop",
  active_orders: "Customers with active orders",
  ready_pickup: "Orders ready for pickup",
  selected: "Selected customers",
} as const;

export type Audience = keyof typeof AUDIENCES;

export function isAudience(v: string): v is Audience {
  return v in AUDIENCES;
}

/** Compact timestamp for conversation rows — "9:41 AM", "Tue", "Mar 4". */
export function messageStamp(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const now = Date.now();
  const diff = now - date.getTime();
  const day = 1000 * 60 * 60 * 24;
  if (diff < day && date.getDate() === new Date(now).getDate()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (diff < day * 7) return date.toLocaleDateString("en-US", { weekday: "short" });
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
