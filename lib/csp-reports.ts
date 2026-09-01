import "server-only";
import { prisma } from "@/lib/db";

/**
 * CSP violation reports: route normalisation and retention.
 *
 * Deliberately NOT in lib/rate-limit.ts, where the retention helper started.
 * That file holds an invariant worth protecting — its self-test asserts the
 * limiter touches no table but its own, so it can never write to a Seller or a
 * Customer — and parking an unrelated delete there quietly broke it. The test
 * caught it, which is the point of writing an invariant down.
 */

/* ------------------------------------------------ route normalisation ---- */

/**
 * Every page route in this application, exactly as the app directory defines
 * them.
 *
 * ── WHY THE WHOLE LIST, INCLUDING STATIC ROUTES ───────────────────────────
 *
 * Because specificity is the entire problem. `/dashboard/drops/new` and
 * `/dashboard/drops/[id]` have the same shape, and so do `/messages/login` and
 * `/messages/[conversationId]`, `/admin/activation` and `/admin/[id]`,
 * `/my/orders` and `/my/orders/[id]`. A pattern list containing only the
 * dynamic routes would fold `new`, `login` and `activation` into an id
 * parameter and quietly lose the distinction. Matching against the full list
 * with literal segments winning — which is how Next's own router resolves —
 * keeps every static route as itself.
 *
 * ── WHY THIS IS A TABLE AND NOT A REGEX ───────────────────────────────────
 *
 * A generalised "replace anything that looks like an id" rule would collapse
 * unrelated routes and would be wrong the first time a slug looked like a
 * number. This list is explicit and a self-test asserts it matches the app
 * directory exactly, so a new route cannot be added without updating it.
 *
 * ── THE ROUTE THAT MATTERS MOST ───────────────────────────────────────────
 *
 * `/pay/[token]` carries a LIVE WALK-UP PAYMENT TOKEN as a path segment, not a
 * query parameter. Query strings are stripped everywhere in this file, but that
 * would not have saved this one. It must normalise to `/pay/[token]` and the
 * token must never reach the database. There is a test named after it.
 */
export const ROUTE_PATTERNS = [
  "/",
  "/admin",
  "/admin/[id]",
  "/admin/activation",
  "/admin/commissions",
  "/admin/dropmeet",
  "/admin/dropmeet/locations/[id]",
  "/admin/dropmeet/new",
  "/admin/sales-reps",
  "/admin/sales-reps/[id]",
  "/dashboard",
  "/dashboard/analytics",
  "/dashboard/billing",
  "/dashboard/customers",
  "/dashboard/discoverability",
  "/dashboard/drops",
  "/dashboard/drops/[id]",
  "/dashboard/drops/[id]/edit",
  "/dashboard/drops/[id]/sale",
  "/dashboard/drops/new",
  "/dashboard/messages",
  "/dashboard/messages/[conversationId]",
  "/dashboard/orders",
  "/dashboard/payments",
  "/dashboard/products",
  "/dashboard/referrals",
  "/dashboard/store",
  "/dashboard/where-ill-be",
  "/discover",
  "/dropmeet",
  "/dropmeet/add",
  "/dropmeet/events/[slug]",
  "/dropmeet/locations/[slug]",
  "/dropmeet/markets/[slug]",
  "/forgot",
  "/help",
  "/help/[slug]",
  "/login",
  "/messages",
  "/messages/[conversationId]",
  "/messages/login",
  "/my",
  "/my/account",
  "/my/history",
  "/my/orders",
  "/my/orders/[id]",
  "/my/rewards",
  "/my/saved",
  "/order/[id]",
  "/pay/[token]",
  "/pricing",
  "/privacy",
  "/rep",
  "/rep/login",
  "/reset",
  "/s/[slug]",
  "/s/[slug]/[dropId]",
  "/sell/[category]",
  "/signup",
  "/sms",
  "/terms",
  "/vendor/signup",
] as const;

/** Longest single stored path. */
const MAX_PATH = 512;

/** Deeper than any real route; anything longer is not one of ours. */
const MAX_SEGMENTS = 12;

const SPLIT: readonly (readonly string[])[] = ROUTE_PATTERNS.map((p) => segmentsOf(p));

function segmentsOf(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Reduce a document path to its route pattern.
 *
 * `/s/britts-bunnies` → `/s/[slug]`
 * `/order/cmth12ab…`  → `/order/[id]`
 * `/pay/<live token>` → `/pay/[token]`
 * `/dashboard/drops/new` → `/dashboard/drops/new`   (static, unchanged)
 *
 * Rows are then bounded by the number of ROUTES rather than by traffic or by
 * how many storefronts and orders exist — and the answer to "which page has the
 * violation?" is better expressed as a route than as one arbitrary instance of
 * it.
 *
 * An unrecognised path falls back to a sanitised pathname: no query, no
 * fragment, no control characters, length-capped. Since the pattern list is
 * asserted to match the app directory, an unrecognised path is a 404 or a
 * probe, not one of our pages.
 */
export function normalizeDocumentPath(pathname: string): string {
  const clean = sanitizePathname(pathname);
  if (clean === "/") return "/";

  const segments = segmentsOf(clean);
  if (segments.length === 0 || segments.length > MAX_SEGMENTS) return clean;

  let best: { pattern: string; literals: number } | null = null;

  for (let i = 0; i < SPLIT.length; i++) {
    const candidate = SPLIT[i];
    if (candidate.length !== segments.length) continue;

    let literals = 0;
    let matched = true;
    for (let s = 0; s < candidate.length; s++) {
      const part = candidate[s];
      if (part.startsWith("[")) continue; // a parameter matches any one segment
      if (part !== segments[s]) { matched = false; break; }
      literals++;
    }
    // Literal segments win, which is what keeps /dashboard/drops/new out of
    // /dashboard/drops/[id].
    if (matched && (!best || literals > best.literals)) {
      best = { pattern: ROUTE_PATTERNS[i], literals };
    }
  }

  return best ? best.pattern : clean;
}

/**
 * Strip everything that is not a path, and everything unprintable.
 *
 * A DropQ URL can carry a magic-link token, a reset token, a search term or a
 * campaign tag in its query. None of that belongs in a violation report, and
 * the path alone identifies the page with the problem.
 */
export function sanitizePathname(value: string): string {
  if (!value) return "";
  let path = value;
  try {
    path = new URL(value).pathname; // drops search and hash by construction
  } catch {
    path = value.split(/[?#]/)[0];
  }
  // Control characters, which have no business in a stored path.
  // eslint-disable-next-line no-control-regex
  path = path.replace(/[\u0000-\u001f\u007f]/g, "");
  if (!path.startsWith("/")) path = "/" + path;
  return path.slice(0, MAX_PATH);
}

/* -------------------------------------------------------- retention ------ */

/** 90 days, matching the analytics window. */
export const CSP_RETENTION_DAYS = 90;

/** When a report seen now should fall out of the table. */
export function cspExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + CSP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Delete reports past their retention date.
 *
 * Called from the existing reminders cron rather than adding a schedule.
 * Indexed on `expiresAt`, so it stays a cheap range delete. Fails soft: a
 * cleanup that cannot run must not take the rest of the job down with it.
 */
export async function purgeExpiredCspReports(now = new Date()): Promise<number> {
  try {
    const { count } = await prisma.cspReport.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  } catch (e) {
    console.error("[csp-report] purge failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}
