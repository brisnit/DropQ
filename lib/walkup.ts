import "server-only";
import { randomBytes } from "crypto";

/**
 * Walk-up (in-person) sales — Phase D: the vendor-side temporary cart.
 *
 * A `WalkUpSale` is NOT an Order. It holds what the vendor rang up for a
 * customer standing in front of them, and nothing else: no inventory is
 * reserved, no Stripe object exists, nobody is charged. Phase E turns it into a
 * real Order at `/pay/{token}` when the customer identifies themselves.
 *
 * ⚠️ Nothing in this file may import Stripe, create an Order, or touch
 * inventory. Those all belong to the existing payment pipeline, which stays the
 * single authority — see docs/IN-PERSON-PAYMENTS-ARCHITECTURE.md §21.
 */

/**
 * How long a rung-up cart stays usable. The vendor is standing right there, and
 * this bounds how long a photographed QR could later be paid. Stripe's own
 * session gets a separate 60 minutes in Phase E, starting when the customer
 * actually submits.
 */
export const WALKUP_TTL_MINUTES = 30;

/** Sanity bounds — a booth cart, not a wholesale order. */
export const MAX_WALKUP_LINES = 50;
export const MAX_WALKUP_QTY_PER_LINE = 999;

/**
 * Server-side feature gate, three states. Deliberately NOT `NEXT_PUBLIC_`:
 * availability must stay authoritative even if the client bundle is modified,
 * so every server path checks it rather than trusting hidden UI.
 *
 *   unset / anything else → off for everyone
 *   "internal"            → only vendors classified internal (the pilot cohort)
 *   "true"                → every eligible vendor
 *
 * `internal` exists so the canary pilot needs no hard-coded vendor name, id or
 * ⚠️ OVERLOADED FLAG, on the backlog. `internalKind` decides two unrelated
 * things: this pilot cohort, and exclusion from business reporting
 * (lib/reporting.ts). They coincide today only because the pilot happens to be
 * DropQ's own accounts. The first REAL vendor to join Walk-Up would have to be
 * marked internal to get the feature, which would remove them from business
 * metrics — at which point these need separating. Do not add new meanings to
 * this field.
 *
 * email: the cohort is whoever `Seller.internalKind` says it is, so
 * reclassifying a vendor moves them in or out with a single database update.
 *
 * ⚠️ This gates AVAILABILITY only. It never bypasses payment safety —
 * `canStartInPersonSale()` still requires the vendor to be Stripe charge-ready,
 * and an internal vendor without Stripe cannot sell.
 */
export type WalkUpMode = "off" | "internal" | "all";

export function walkUpMode(): WalkUpMode {
  const v = process.env.WALKUP_ENABLED;
  if (v === "true") return "all";
  if (v === "internal") return "internal";
  return "off";
}

/** Seller shape the gate needs. Kept minimal so any caller can satisfy it. */
export type WalkUpSeller = { internalKind: string | null };

/**
 * In `internal` mode a seller is REQUIRED — calling without one returns false,
 * which is the safe default for "is this feature on at all?" checks.
 */
export function isWalkUpEnabled(seller?: WalkUpSeller | null): boolean {
  const mode = walkUpMode();
  if (mode === "off") return false;
  if (mode === "all") return true;
  return !!seller?.internalKind;
}

/**
 * The public payment credential. 32 random bytes, matching the existing
 * `lib/tokens.ts` / `lib/customer-auth.ts` convention.
 *
 * Separate from `WalkUpSale.id` on purpose: the id is a cuid that leaks
 * creation time and ordering, and it appears in vendor URLs. The token is what
 * a stranger would have to guess to pay someone else's cart.
 */
export function newWalkUpToken(): string {
  return randomBytes(32).toString("hex");
}

export function walkUpExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + WALKUP_TTL_MINUTES * 60_000);
}

/** Where the customer will pay. The route itself lands in Phase E. */
export function payUrlFor(token: string, base: string): string {
  return `${base.replace(/\/$/, "")}/pay/${token}`;
}

/* ------------------------------ Derived state ----------------------------- */

/**
 * Never stored — see §3.3. A `status` column could contradict `orderId`;
 * deriving cannot.
 *
 * `converted` outranks everything: once a sale produced an Order, that is the
 * truth regardless of what the clock or a later cancel says.
 */
export type WalkUpState = "open" | "converted" | "canceled" | "expired";

export function walkUpSaleState(
  sale: { orderId: string | null; canceledAt: Date | null; expiresAt: Date },
  now: Date = new Date()
): WalkUpState {
  if (sale.orderId) return "converted";
  if (sale.canceledAt) return "canceled";
  if (sale.expiresAt.getTime() <= now.getTime()) return "expired";
  return "open";
}

/* -------------------------------- Validation ------------------------------ */

export type RequestedLine = { productId: string; quantity: number };

/** What gets snapshotted into `WalkUpSale.lines`. */
export type WalkUpLine = {
  productId: string;
  /** Snapshotted so the vendor's quoted cart survives a later product edit. */
  name: string;
  /** Snapshotted for the same reason. NEVER read from the client. */
  priceCents: number;
  quantity: number;
};

export type ProductForWalkUp = {
  id: string;
  dropId: string;
  name: string;
  priceCents: number;
  inventory: number;
  sold: number;
};

export type WalkUpValidation =
  | { ok: true; lines: WalkUpLine[]; totalCents: number }
  | { ok: false; reason: WalkUpValidationError };

export type WalkUpValidationError =
  | "no_lines"
  | "unknown_product"
  | "bad_quantity"
  | "insufficient_stock"
  | "too_many_lines";

/**
 * Turn a client request into an authoritative snapshot.
 *
 * ⚠️ The caller passes only `{ productId, quantity }`. **Price and name are
 * read from the Product rows here and nowhere else.** There is deliberately no
 * price field in the input, so a forged price is not rejected — it is
 * impossible to express.
 *
 * Stock is checked against `inventory - sold` at this moment as a courtesy, to
 * stop a vendor ringing up something obviously unavailable. It is NOT a
 * reservation: stock can still change before the customer pays, and
 * `finalizePaidOrder`'s conditional increment remains the only authority.
 */
export function validateWalkUpLines(
  drop: { id: string; products: ProductForWalkUp[] },
  requested: RequestedLine[]
): WalkUpValidation {
  const wanted = requested.filter((l) => l.quantity > 0);
  if (wanted.length === 0) return { ok: false, reason: "no_lines" };
  if (wanted.length > MAX_WALKUP_LINES) return { ok: false, reason: "too_many_lines" };

  const byId = new Map(drop.products.map((p) => [p.id, p]));
  const lines: WalkUpLine[] = [];

  for (const l of wanted) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) {
      return { ok: false, reason: "bad_quantity" };
    }
    if (l.quantity > MAX_WALKUP_QTY_PER_LINE) {
      return { ok: false, reason: "bad_quantity" };
    }
    const p = byId.get(l.productId);
    // Covers both "no such product" and "product belongs to another drop":
    // `byId` is built only from this drop's products.
    if (!p || p.dropId !== drop.id) return { ok: false, reason: "unknown_product" };

    const remaining = Math.max(0, p.inventory - p.sold);
    if (l.quantity > remaining) return { ok: false, reason: "insufficient_stock" };

    lines.push({
      productId: p.id,
      name: p.name,
      priceCents: p.priceCents,
      quantity: l.quantity,
    });
  }

  return {
    ok: true,
    lines,
    totalCents: lines.reduce((s, l) => s + l.priceCents * l.quantity, 0),
  };
}

/** Total of an already-snapshotted cart, for display. */
export function walkUpTotalCents(lines: WalkUpLine[]): number {
  return lines.reduce((s, l) => s + l.priceCents * l.quantity, 0);
}

/* --------------------------- Snapshot → Order ----------------------------- */

/**
 * The quoted cart becomes the order's line items.
 *
 * ⚠️ SETTLED RULE: the price in `lines` is authoritative for this transaction.
 * If the vendor said "thirteen dollars", editing the Product price afterwards
 * must not change that customer's bill. Product identity and *inventory* stay
 * live — only the price is frozen.
 */
export function snapshotToOrderItems(lines: WalkUpLine[]) {
  return lines.map((l) => ({
    productId: l.productId,
    name: l.name,
    priceCents: l.priceCents,
    quantity: l.quantity,
  }));
}

/** Parse the Json column back into typed lines. */
export function linesFromJson(value: unknown): WalkUpLine[] {
  return (Array.isArray(value) ? value : []) as WalkUpLine[];
}
