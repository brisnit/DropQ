import "server-only";

// Formatting helpers for a drop's pickup window + location, shown in the store
// timezone across the customer page, order confirmation, emails, and dashboard.
type PickupDrop = {
  pickupStartAt?: Date | null;
  pickupEndAt?: Date | null;
  pickupLocationName?: string | null;
  pickupAddress?: string | null;
  pickupNotes?: string | null;
  pickupInfo?: string | null;
  fulfillment?: string | null;
};

export function hasPickupWindow(d: PickupDrop): boolean {
  return !!(d.pickupStartAt && d.pickupEndAt);
}

/** e.g. "Sat, Jun 27, 10:00 AM – 2:00 PM PDT" (in the store's timezone). */
export function formatPickupWindow(d: PickupDrop, timeZone?: string | null): string | null {
  if (!d.pickupStartAt || !d.pickupEndAt) return null;
  const tz = timeZone || undefined;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const sDay = day.format(d.pickupStartAt);
  const eDay = day.format(d.pickupEndAt);
  const sTime = time.format(d.pickupStartAt);
  const eTime = time.format(d.pickupEndAt);
  return sDay === eDay ? `${sDay}, ${sTime} – ${eTime}` : `${sDay} ${sTime} – ${eDay} ${eTime}`;
}

/** Human location line (name + address), falling back to legacy pickupInfo. */
export function pickupLocation(d: PickupDrop): string | null {
  const parts = [d.pickupLocationName, d.pickupAddress].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  return d.pickupInfo || null;
}

/** A one-line summary for SMS / short contexts. */
export function pickupSummary(d: PickupDrop, timeZone?: string | null): string {
  const win = formatPickupWindow(d, timeZone);
  const loc = pickupLocation(d);
  return [win && `Pickup ${win}`, loc].filter(Boolean).join(" · ");
}
