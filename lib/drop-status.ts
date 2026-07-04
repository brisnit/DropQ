// Computed drop status from the order/pickup windows — always uses server time,
// so it's more reliable than the manually-set `status` alone.
export type DropPhase =
  | "draft"
  | "scheduled" // order window hasn't opened yet
  | "open" // ordering is open now
  | "closed" // ordering closed, pickup not started
  | "pickup" // within the pickup window
  | "completed"; // pickup window has ended

type DropTimes = {
  status: string; // draft | live | closed
  mode: string; // preorder | live
  opensAt: Date | null;
  closesAt: Date | null;
  pickupStartAt?: Date | null;
  pickupEndAt?: Date | null;
};

export function computeDropPhase(d: DropTimes, now: Date = new Date()): DropPhase {
  if (d.status === "draft") return "draft";
  // Live-selling drops take orders on-site while the seller keeps them live.
  if (d.mode === "live") return d.status === "live" ? "open" : "closed";

  // Preorder drops are governed by their order window.
  if (d.status === "live" && d.opensAt && now < d.opensAt) return "scheduled";
  const orderingClosed = d.status === "closed" || (!!d.closesAt && now > d.closesAt);
  if (!orderingClosed) return "open";

  // Ordering is closed → pickup phases.
  if (d.pickupEndAt && now > d.pickupEndAt) return "completed";
  if (d.pickupStartAt && now >= d.pickupStartAt) return "pickup";
  return "closed";
}

/** Single source of truth for whether an order may be placed right now. */
export function isOrderingOpen(d: DropTimes, now: Date = new Date()): boolean {
  if (d.status !== "live") return false;
  if (d.mode === "live") return true; // live selling: open while live
  if (d.opensAt && now < d.opensAt) return false;
  if (d.closesAt && now > d.closesAt) return false;
  return true;
}

export function phaseLabel(phase: DropPhase): string {
  switch (phase) {
    case "draft": return "Draft";
    case "scheduled": return "Scheduled";
    case "open": return "Ordering open";
    case "closed": return "Ordering closed";
    case "pickup": return "Pickup available";
    case "completed": return "Completed";
  }
}
