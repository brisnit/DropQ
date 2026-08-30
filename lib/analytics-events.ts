/**
 * The canonical DropQ analytics vocabulary.
 *
 * ONE list. Before this file there were two: the shipped client unions in
 * lib/analytics.ts (discovery, DropMeet, guidance) and a paper specification in
 * docs/VENDOR-ACTIVATION.md §7 that was never implemented. They disagreed about
 * names for the same moments. This module is the reconciliation, and both of
 * those are now downstream of it.
 *
 * Pure — no Prisma, no `server-only`, no environment. Middleware (edge), the
 * route handler, server actions, client components and the self-test all import
 * it, so it must run everywhere.
 *
 * RULES THAT ARE NOT NEGOTIABLE
 *
 *  1. `<noun>_<verb>`, matching the convention the shipped events already use.
 *  2. A dimension is a property, never a new event. `pricing_viewed` does not
 *     exist; it is `page_viewed` with `path: "/pricing"`. Otherwise "top landing
 *     pages" needs a schema change every time a page is added.
 *  3. Business outcomes are emitted server-side from the authoritative
 *     transition. A browser click is evidence that a button was pressed, not
 *     that a vendor became charge-ready.
 *  4. Nothing here may carry PII. See FORBIDDEN_PROPERTY_KEYS.
 */

/* -------------------------------------------------------------------------- */
/*  Events                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Behavioural events. Emitted from the browser or from a public page render;
 * they describe what someone looked at, not what they achieved.
 */
export const BEHAVIOUR_EVENTS = [
  "page_viewed",
  "vendor_signup_viewed",
  "vendor_signup_started",
  "drop_viewed",
] as const;

/**
 * Business outcomes. Emitted ONLY from the server transition that makes them
 * true — see rule 3. Wiring these is Phase B; the vocabulary is fixed here so
 * Phase B has nothing to invent.
 */
export const CONVERSION_EVENTS = [
  "vendor_signed_up",
  "vendor_stripe_started",
  "vendor_stripe_charge_ready",
  "vendor_publish_blocked",
  "vendor_first_drop_created",
  "vendor_first_drop_published",
  "vendor_first_drop_shared",
  "vendor_first_paid_order",
  "checkout_started",
  "purchase_completed",
] as const;

export const ANALYTICS_EVENTS = [...BEHAVIOUR_EVENTS, ...CONVERSION_EVENTS] as const;

export type BehaviourEvent = (typeof BEHAVIOUR_EVENTS)[number];
export type ConversionEvent = (typeof CONVERSION_EVENTS)[number];
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

const EVENT_SET: ReadonlySet<string> = new Set(ANALYTICS_EVENTS);

/** Is this a name the sink will accept? Unknown names are rejected, not stored. */
export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return EVENT_SET.has(name);
}

/**
 * Which events the browser is allowed to report.
 *
 * `/api/track` refuses a conversion event over HTTP no matter who sends it.
 * Without this the public endpoint is a way to manufacture a funnel: anyone
 * could POST `vendor_first_paid_order` and DropQ would believe it.
 */
const CLIENT_REPORTABLE: ReadonlySet<string> = new Set(BEHAVIOUR_EVENTS);

export function isClientReportable(name: string): name is BehaviourEvent {
  return CLIENT_REPORTABLE.has(name);
}

/* -------------------------------------------------------------------------- */
/*  Renames                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Names that were proposed or specced and are NOT what we use, with the reason.
 *
 * Kept in code rather than a changelog so that a future reader who finds
 * `stripe_ready` in an old document can see, in one place, that it was
 * deliberately superseded and by what.
 */
export const SUPERSEDED_EVENT_NAMES: Record<string, { use: string; why: string }> = {
  site_viewed: {
    use: "page_viewed",
    why: "A dimension, not an event — the page is a property.",
  },
  pricing_viewed: {
    use: 'page_viewed { path: "/pricing" }',
    why: "One event per page turns 'top landing pages' into a schema change.",
  },
  vendor_signup_completed: {
    use: "vendor_signed_up",
    why: "The name already specced in docs/VENDOR-ACTIVATION.md §7.",
  },
  stripe_setup_started: {
    use: "vendor_stripe_started",
    why: "Every vendor-lifecycle event carries the vendor_ prefix.",
  },
  stripe_ready: {
    use: "vendor_stripe_charge_ready",
    why: "'Ready' is ambiguous where the code distinguishes not_started, incomplete, restricted, charge_ready and suspended.",
  },
  first_drop_created: {
    use: "vendor_first_drop_created",
    why: "Every vendor-lifecycle event carries the vendor_ prefix, so a funnel query can select the whole lifecycle by prefix.",
  },
  first_drop_published: {
    use: "vendor_first_drop_published",
    why: "Same prefix rule; also disambiguates from a customer viewing a published drop.",
  },
  first_drop_shared: {
    use: "vendor_first_drop_shared",
    why: "Same prefix rule; the shipped client event drop_shared is the UI acknowledgement, not the milestone.",
  },
  first_paid_order: {
    use: "vendor_first_paid_order",
    why: "Same prefix rule; 'first' alone is ambiguous once customers have firsts too.",
  },
  item_viewed: {
    use: "(dropped)",
    why: "Item-level interaction is a large volume of events for a question nobody is asking yet.",
  },
  vendor_email_verified: {
    use: "(dropped)",
    why: "Email verification was removed from the activation checklist in Phase G; it is no longer a funnel stage.",
  },
};

/**
 * Events that exist today under lib/analytics.ts and describe a moment this
 * vocabulary ALSO names. They keep their names — they are shipped, they are
 * fine, and renaming them would break nothing but would rewrite 43 call sites
 * for no gain — but the canonical event is what the funnel counts.
 */
export const PARALLEL_LEGACY_EVENTS: Record<string, string> = {
  // The guidance event is a UI acknowledgement: the vendor pressed share.
  // The conversion event is the authoritative fact and is emitted server-side.
  drop_shared: "vendor_first_drop_shared",
  discovery_viewed: "page_viewed",
  dropmeet_opened: "page_viewed",
};

/* -------------------------------------------------------------------------- */
/*  Properties                                                                */
/* -------------------------------------------------------------------------- */

export type DeviceClass = "mobile" | "tablet" | "desktop" | "unknown";

/**
 * The columns every event carries. Deliberately small: this is the set that
 * answers the questions in the brief, and nothing beyond it.
 */
export type AnalyticsContext = {
  visitorId: string;
  sessionId: string;
  /** Path only. NEVER a full URL — see sanitizePath(). */
  path: string;
  /** Registrable domain of the referrer, or null. Never a full referrer URL. */
  referrerDomain: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  device: DeviceClass;
  /** "production" | "preview" | "development" | "test" */
  env: string;
  sellerId?: string | null;
  customerId?: string | null;
  dropId?: string | null;
};

/**
 * Property keys that may never appear in the free-form `props` bag.
 *
 * This is a privacy control with teeth: the sink drops an event carrying any of
 * them and the self-test asserts the list. `query` is here for the same reason
 * `help_searched` has no `query` field in lib/analytics.ts — the standing
 * decision is that raw free text is not retained.
 */
export const FORBIDDEN_PROPERTY_KEYS = [
  "email",
  "password",
  "passwordhash",
  "name",
  "fullname",
  "firstname",
  "lastname",
  "phone",
  "address",
  "card",
  "cardnumber",
  "cvc",
  "pan",
  "token",
  "secret",
  "apikey",
  "authorization",
  "cookie",
  "session",
  "ip",
  "ipaddress",
  "query",
  "searchquery",
  "q",
  "message",
  "body",
  "note",
  "notes",
  "url",
  "href",
  "referrer",
] as const;

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_PROPERTY_KEYS);

/** Does this props bag contain anything we refuse to store? */
export function forbiddenKeysIn(props: Record<string, unknown>): string[] {
  return Object.keys(props).filter((k) => FORBIDDEN_SET.has(k.toLowerCase().replace(/[_-]/g, "")));
}

/* -------------------------------------------------------------------------- */
/*  URL handling                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Query parameters that survive. Everything else is discarded before storage.
 *
 * An ALLOWLIST, not a blocklist. A blocklist means every future feature that
 * puts something sensitive in a query string silently starts logging it; an
 * allowlist means the default for anything new is "not stored".
 */
export const RETAINED_QUERY_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
] as const;

const RETAINED_SET: ReadonlySet<string> = new Set(RETAINED_QUERY_PARAMS);

/** Longest path we will store. Anything longer is truncated, not rejected. */
const MAX_PATH = 512;

/**
 * Reduce a URL or path to the bare path we are willing to keep.
 *
 * Strips the query string and the fragment entirely — `?session_id=`,
 * `?token=`, `?email=` and every future equivalent go with them. Also strips a
 * trailing slash so `/pricing` and `/pricing/` aggregate as one page.
 */
export function sanitizePath(input: string): string {
  let path = input;
  try {
    // Accepts both "/pricing?x=1" and "https://host/pricing?x=1".
    path = new URL(input, "http://x").pathname;
  } catch {
    path = String(input).split("?")[0].split("#")[0];
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path.slice(0, MAX_PATH);
}

/** Only the parameters on the allowlist, as a plain object. */
export function retainedParams(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of RETAINED_SET) {
    const v = search.get(key);
    if (v) out[key] = v.slice(0, 128);
  }
  return out;
}

/**
 * Registrable-ish domain of a referrer, lowercased, `www.` removed.
 *
 * The full referrer URL is never stored: a referrer can carry another site's
 * query string, which is their user's data, not ours to keep.
 */
export function referrerDomain(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host.replace(/^www\./, "").slice(0, 128) || null;
  } catch {
    return null;
  }
}

/** Coarse device class from a user-agent. Three buckets, no fingerprinting. */
export function deviceClass(userAgent: string | null | undefined): DeviceClass {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "mobile";
  return "desktop";
}

/* -------------------------------------------------------------------------- */
/*  Bots                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Crawlers, previewers and monitors, dropped before anything is written.
 *
 * At DropQ's current traffic these would be the MAJORITY of "visitors", which
 * would make the top-of-funnel number worse than having no number at all.
 *
 * Deliberately conservative — this list catches the high-volume, self-declaring
 * bots. It is not an adversarial defence and is not trying to be.
 */
const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|pinterest|vercelbot|vercel-screenshot|headlesschrome|playwright|puppeteer|lighthouse|chrome-lighthouse|gtmetrix|pingdom|uptimerobot|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http-client|postman/i;

export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // No UA at all is a script, not a person.
  return BOT_PATTERN.test(userAgent);
}
