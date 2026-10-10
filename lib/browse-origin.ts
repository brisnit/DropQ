/**
 * Where a visitor was browsing before they opened a storefront or a drop.
 *
 * ── THE PROBLEM ───────────────────────────────────────────────────────────
 *
 * A storefront and a drop page are both arrived at from several directions: a
 * shared link, a QR code on a table, the vendor directory, or Find Drops. Once
 * there, neither page offered any way back into DropQ. The only exit was the
 * browser's own back button, and that is not ours to rely on — the visit may
 * have started on Instagram or in a text message, in which case "back" leaves
 * DropQ entirely. So the link has to be a real href to a page we name.
 *
 * ── WHY A KEY AND NOT A URL ───────────────────────────────────────────────
 *
 * The obvious design is `?from=/discover%3Ff%3Dfood` — carry the return URL in
 * the query string and render it into the link. That hands anyone who can send
 * a link the ability to choose where our "back" button points: a crafted
 * `?from=https://evil.example` renders a DropQ page with a back link off the
 * site, which is a phishing primitive, and sanitising URLs by hand is exactly
 * the kind of thing that gets it wrong on the third edge case.
 *
 * Instead the parameter is a short KEY into this table. An unrecognised key is
 * not an error and not a redirect; it simply falls back. The href can only ever
 * be one of the paths written below, so there is no URL to validate and no way
 * to point it off DropQ.
 *
 * ── FILTERS ───────────────────────────────────────────────────────────────
 *
 * Find Drops keeps its filter in React state and its location in
 * localStorage. Only the filter needs carrying in the URL: returning to
 * /discover restores the location by itself, so `?f=food` is enough to put the
 * visitor back where they were. The id is validated against the same list the
 * page uses, so an unknown value falls back to the unfiltered page rather than
 * producing a dead filter chip.
 */

export const BROWSE_ORIGINS = {
  discover: { path: "/discover", label: "Find Drops" },
  vendors: { path: "/vendors", label: "Vendors" },
} as const;

export type BrowseOriginKey = keyof typeof BROWSE_ORIGINS;

/** Where a visitor with no recorded origin is sent. */
export const DEFAULT_BROWSE_ORIGIN: BrowseOriginKey = "discover";

/**
 * The filter ids /discover understands.
 *
 * Duplicated from the FILTERS table in components/discover-client.tsx, because
 * that table carries labels and fetch metadata and lives in a client bundle.
 * A self-test asserts the two lists stay identical, so adding a filter there
 * without adding it here fails the suite rather than silently producing back
 * links that drop the filter.
 */
export const DISCOVER_FILTER_IDS = [
  "all",
  "food",
  "collectibles",
  "art",
  "apparel",
  "events",
  "today",
  "weekend",
  "saved",
] as const;

export const BROWSE_ORIGIN_PARAM = "from";
export const BROWSE_FILTER_PARAM = "f";

function isOriginKey(v: string | undefined): v is BrowseOriginKey {
  return v !== undefined && Object.prototype.hasOwnProperty.call(BROWSE_ORIGINS, v);
}

/**
 * The query string to hang on an outgoing link to a storefront or drop, so the
 * page it leads to can offer the way back. Returns "" for no origin, so it can
 * be concatenated unconditionally.
 */
export function browseOriginQuery(origin: BrowseOriginKey, filter?: string): string {
  const qs = new URLSearchParams({ [BROWSE_ORIGIN_PARAM]: origin });
  // "all" is the default view, so saying so in the URL only adds noise.
  if (
    origin === "discover" &&
    filter &&
    filter !== "all" &&
    (DISCOVER_FILTER_IDS as readonly string[]).includes(filter)
  ) {
    qs.set(BROWSE_FILTER_PARAM, filter);
  }
  return `?${qs.toString()}`;
}

export type BackLink = { href: string; label: string; isFallback: boolean };

/**
 * Resolve the back link for a page reached from somewhere in DropQ.
 *
 * Always returns a link. `isFallback` says whether it was derived from a
 * recorded origin or is the default — the caller may word it differently, but
 * must never render nothing, because "no way back" is the bug this fixes.
 */
export function resolveBackLink(params: {
  from?: string | string[];
  f?: string | string[];
}): BackLink {
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const f = Array.isArray(params.f) ? params.f[0] : params.f;

  const isFallback = !isOriginKey(from);
  const key: BrowseOriginKey = isOriginKey(from) ? from : DEFAULT_BROWSE_ORIGIN;
  const origin = BROWSE_ORIGINS[key];

  let href: string = origin.path;
  if (
    key === "discover" &&
    f &&
    f !== "all" &&
    (DISCOVER_FILTER_IDS as readonly string[]).includes(f)
  ) {
    href = `${origin.path}?${BROWSE_FILTER_PARAM}=${encodeURIComponent(f)}`;
  }

  return { href, label: origin.label, isFallback };
}

/**
 * Re-emit a recorded origin so it survives one more hop — a storefront linking
 * on to one of its own drops.
 *
 * Returns "" when there is nothing recorded, so the drop page falls back to
 * "Find Drops" rather than carrying an invented origin. Validated through the
 * same table as everything else: an unrecognised key is dropped, not echoed,
 * so a crafted value cannot be reflected into a link.
 */
export function originPassThrough(params: {
  from?: string | string[];
  f?: string | string[];
}): string {
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const f = Array.isArray(params.f) ? params.f[0] : params.f;
  if (!isOriginKey(from)) return "";
  return browseOriginQuery(from, typeof f === "string" ? f : undefined);
}
