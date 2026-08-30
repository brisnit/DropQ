/**
 * Explicit UTC boundaries.
 *
 * WHY. A cleanup script written to find eight rows created at 04:11 UTC used
 * `new Date("2026-08-30 04:00:00")` for its window. That form is parsed in the
 * LOCAL zone — on a machine in PDT it became 11:00 UTC, the window missed every
 * row, and the script reported "0 candidates" for a set of eight that plainly
 * existed. It failed silently and it failed in the safe direction by luck, not
 * by design. Shifted the other way it would have selected rows outside the
 * intended window, and the operation on the other side of that query was a
 * DELETE against production.
 *
 * The rule this module enforces: any date boundary used for a database range —
 * a cleanup window, a retention cutoff, a reporting period, an analytics
 * bucket — is written in explicit UTC or it does not parse at all.
 *
 * SCOPE. This is for boundaries, not for display. Drop schedules, pickup
 * windows and everything a vendor sees stay on the store's own timezone via
 * lib/format.ts and the existing schedule code; that is correct and is not
 * touched here.
 */

/** ISO 8601 with an explicit UTC designator, e.g. 2026-08-30T04:00:00.000Z */
const STRICT_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;
/** A bare calendar day, unambiguous: JS parses date-only ISO strings as UTC. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a boundary, or throw.
 *
 * Rejects `"2026-08-30 04:00:00"` (space-separated, local), `"08/30/2026"`,
 * and anything else whose meaning depends on the machine it runs on. Accepts
 * `"2026-08-30T04:00:00Z"` and `"2026-08-30"`.
 */
export function utc(input: string): Date {
  if (!STRICT_UTC.test(input) && !DATE_ONLY.test(input)) {
    throw new Error(
      `Ambiguous date "${input}". A database boundary must be explicit UTC — ` +
        `"YYYY-MM-DDTHH:mm:ssZ" or "YYYY-MM-DD". A space-separated string is ` +
        `parsed in the machine's local zone, which is how a cleanup window ` +
        `once missed every row it was written to find.`
    );
  }
  const date = new Date(DATE_ONLY.test(input) ? `${input}T00:00:00.000Z` : input);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date "${input}"`);
  return date;
}

/** Is this string safe to pass to `new Date()` without ambiguity? */
export function isUnambiguous(input: string): boolean {
  return STRICT_UTC.test(input) || DATE_ONLY.test(input);
}

/** `[start, end)` for one UTC day. End-exclusive — no `23:59:59` off-by-one. */
export function utcDay(day: string): { start: Date; end: Date } {
  const start = utc(day);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

/**
 * `[start, end)` for the last `days` days, ending now.
 *
 * The window a dashboard means by "last 7 days": end-exclusive, anchored to an
 * instant rather than a calendar boundary, so it cannot double-count or skip an
 * event at a midnight edge.
 */
export function utcWindow(days: number, now: Date = new Date()): { start: Date; end: Date } {
  if (!Number.isFinite(days) || days <= 0) throw new Error(`utcWindow needs a positive day count, got ${days}`);
  return { start: new Date(now.getTime() - days * 86_400_000), end: now };
}

/**
 * The cutoff for a retention policy: everything strictly older than this is
 * deletable. Analytics events are retained 90 days — see
 * docs/ANALYTICS-PRIVACY-DRAFT.md §5. Nothing deletes anything yet.
 */
export function retentionCutoff(days: number, now: Date = new Date()): Date {
  if (!Number.isFinite(days) || days <= 0) throw new Error(`retentionCutoff needs a positive day count, got ${days}`);
  return new Date(now.getTime() - days * 86_400_000);
}

/** Days that raw analytics events are kept. Approved, not yet enforced. */
export const ANALYTICS_RETENTION_DAYS = 90;
