/**
 * Anonymous visitor and session identity, and the single switch that decides
 * whether any of it happens at all.
 *
 * Pure and dependency-free so the edge middleware, the route handler, server
 * actions and the tests all share one definition. No Prisma, no `server-only`.
 *
 * WHY THE IDENTIFIERS ARE httpOnly
 *
 * Page JavaScript never needs to read them. The browser sends the cookie, the
 * server reads it off the request and stamps the event. That means:
 *
 *   - no localStorage, no sessionStorage, nothing in the DOM,
 *   - no way for a third-party script on the page to harvest the id,
 *   - and nothing to fingerprint with, because there is no fingerprinting —
 *     the id is 128 random bits and carries no information about the device.
 *
 * It is stricter than the brief asked for and simpler to build.
 */

/* -------------------------------------------------------------------------- */
/*  The policy switch                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How analytics identity behaves. ONE decision, read from ONE place.
 *
 *   off      — no identity cookies are set, no events are written. THE DEFAULT.
 *   on       — identity cookies are set for everyone.
 *   consent  — identity cookies are set only for visitors who have consented.
 *
 * `off` is the default deliberately. The privacy policy currently promises
 * essential cookies only (§6), so the system must not start setting analytics
 * cookies in production merely because the code shipped. Flipping this is a
 * policy decision, made once, in one environment variable — not a code change.
 *
 * The three modes exist now, together, so that adding a consent banner later is
 * a UI change and a cookie write. Nothing in the tracking system moves.
 */
export type AnalyticsMode = "off" | "on" | "consent";

export function analyticsMode(env: Record<string, string | undefined> = process.env): AnalyticsMode {
  const raw = (env.ANALYTICS_MODE ?? "").trim().toLowerCase();
  return raw === "on" || raw === "consent" ? raw : "off";
}

/** Name of the cookie a future consent UI would set. Nothing writes it yet. */
export const CONSENT_COOKIE = "dq_analytics_consent";

/**
 * May we identify this visitor?
 *
 * In `consent` mode the answer is no until the consent cookie says yes, which
 * is what makes a consent banner a drop-in rather than a rewrite.
 */
export function identityAllowed(
  mode: AnalyticsMode,
  consentCookieValue: string | null | undefined
): boolean {
  if (mode === "off") return false;
  if (mode === "on") return true;
  return consentCookieValue === "granted";
}

/* -------------------------------------------------------------------------- */
/*  The environment guard                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Preview deployments share DATABASE_URL with production — one Vercel variable
 * scoped to both environments. Without this guard every crawler, link unfurler
 * and QA click on a preview URL becomes production acquisition traffic.
 *
 * Preview writes NOWHERE. That is the smallest safe answer: an isolated preview
 * analytics store would mean a second database to provision and nobody would
 * ever read it.
 *
 * Note this refuses on `VERCEL_ENV`, not on `NODE_ENV`: a preview build is
 * `NODE_ENV=production`, so checking NODE_ENV would let preview through — the
 * exact mistake this guard exists to prevent.
 */
export function analyticsEnv(env: Record<string, string | undefined> = process.env): string {
  return env.VERCEL_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
}

export function writesAllowed(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === "preview") return false;
  return analyticsMode(env) !== "off";
}

/** Why a write was refused — for the self-test and for the dev console. */
export function writeRefusalReason(
  env: Record<string, string | undefined> = process.env
): string | null {
  if (env.VERCEL_ENV === "preview") return "preview_deployment";
  if (analyticsMode(env) === "off") return "analytics_off";
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Cookies                                                                   */
/* -------------------------------------------------------------------------- */

export const VISITOR_COOKIE = "dq_vid";
export const SESSION_COOKIE = "dq_sid";
/** First- and last-touch acquisition, one cookie holding both. */
export const ATTRIBUTION_COOKIE = "dq_attr";

/** 12 months — long enough to cover a realistic consider-then-sign-up gap. */
export const VISITOR_MAX_AGE = 60 * 60 * 24 * 365;
/** 30 minutes, re-set on every request, so it slides with activity. */
export const SESSION_MAX_AGE = 60 * 30;
/** Attribution outlives the session but not the visitor id. */
export const ATTRIBUTION_MAX_AGE = 60 * 60 * 24 * 90;

/**
 * 128 bits of randomness, hex encoded.
 *
 * `crypto.randomUUID()` would do, but a bare hex string keeps the value opaque
 * — a UUID reads like a database key and invites someone to treat it as one.
 * Uses Web Crypto, which exists in the edge runtime, Node and the browser.
 */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const ID_SHAPE = /^[0-9a-f]{32}$/;

/** Reject anything that isn't one of our own ids — including a forged one. */
export function isValidId(value: string | null | undefined): value is string {
  return typeof value === "string" && ID_SHAPE.test(value);
}

/**
 * A short, non-reversible handle for showing a visitor in the admin UI.
 *
 * The raw id is never rendered. This is a display label, not a key.
 */
export function visitorHandle(visitorId: string): string {
  return visitorId.slice(0, 6).toUpperCase();
}

/** Cookie options shared by all three. `secure` only where there is TLS. */
export function cookieOptions(maxAge: number, secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure,
  };
}

/* -------------------------------------------------------------------------- */
/*  Speculative navigation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Is this request a prefetch rather than a person going somewhere?
 *
 * Covers the markers that DO reach middleware: `purpose: prefetch` (Safari,
 * Firefox) and `sec-purpose: prefetch;prerender` (speculation rules).
 *
 * ⚠️ It cannot see Next's own `next-router-prefetch` — see isRealNavigation().
 */
export function isSpeculativeRequest(headers: {
  get(name: string): string | null;
}): boolean {
  const purpose = headers.get("purpose") ?? headers.get("x-purpose") ?? "";
  if (/prefetch|preview/i.test(purpose)) return true;
  const secPurpose = headers.get("sec-purpose") ?? "";
  if (/prefetch|prerender/i.test(secPurpose)) return true;
  return false;
}

/**
 * Did a person actually navigate here, in a top-level browser navigation?
 *
 * THIS IS WHERE THE FIRST ATTEMPT AT THIS FIX WENT WRONG, so the measurements
 * are recorded rather than the reasoning.
 *
 * On the wire, Chrome sends `next-router-prefetch: 1` and `rsc: 1` for a
 * prefetch — which is what a browser-side capture shows, and what the first
 * version of this guard keyed on. But Next lists both in FLIGHT_HEADERS and
 * strips them (`stripFlightHeaders`, server/base-server.js) before user
 * middleware runs. Measured at the middleware, with the request made three
 * different ways:
 *
 *   header sent                    middleware sees
 *   next-router-prefetch: 1        (nothing — stripped)
 *   rsc: 1                         (nothing — stripped)
 *   purpose: prefetch              purpose
 *
 * So a prefetch and a click are indistinguishable by Next's own headers here.
 * What does survive, and separates them cleanly:
 *
 *   navigation type                sec-fetch-dest   sec-fetch-mode
 *   typed URL / QR / external link document         navigate
 *   any in-page fetch (prefetch,
 *     and client-side link click)  empty            cors
 *
 * THE RULE, and its cost: dq_touch is created only on a top-level document
 * navigation. That means an in-app CLICK through to a storefront no longer
 * creates one. This is a deliberate trade, not an oversight:
 *
 *  - at this layer a click and a prefetch are the same request, so allowing
 *    clicks means allowing prefetches, which is the bug;
 *  - every acquisition path that matters — scanning a QR, opening a shared
 *    link, following an external link — is a document navigation;
 *  - an in-app click means the visitor was already on DropQ, which is a much
 *    weaker claim to having acquired them. Honouring it is precisely how the
 *    marketing site's demo storefront came to own the first touch of every
 *    homepage visitor.
 *
 * A missing `sec-fetch-dest` is treated as a real navigation: only quite old
 * browsers omit it, and they still deserve attribution.
 */
export function isRealNavigation(headers: { get(name: string): string | null }): boolean {
  if (isSpeculativeRequest(headers)) return false;
  const dest = headers.get("sec-fetch-dest");
  if (dest === null) return true;
  return dest === "document";
}

/* -------------------------------------------------------------------------- */
/*  Attribution                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Where a visitor came from.
 *
 * `source` is derived, not raw: a UTM if there is one, otherwise a coarse
 * channel from the referrer. `direct` means we genuinely do not know, and it
 * says so rather than inventing a channel.
 */
export type TouchChannel = "direct" | "search" | "social" | "referral" | "campaign" | "qr";

export type AcquisitionTouch = {
  channel: TouchChannel;
  /** Referrer domain, or the utm_source. Never a full URL. */
  source: string | null;
  /**
   * The EXTERNAL domain that referred this visitor into DropQ, or null.
   *
   * Null for a direct visit and null for internal navigation — drop-q.com is
   * never its own referrer. Stored separately from `source` because `source`
   * may hold a utm_source instead, and an event needs to know which it has.
   */
  referrerDomain: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  /** Landing path for this touch. */
  path: string;
  at: string;
};

export type AttributionCookie = {
  /** Written once. Never overwritten while the cookie lives. */
  first: AcquisitionTouch;
  /** The most recent QUALIFYING touch. Overwritten. */
  last: AcquisitionTouch;
};

const SEARCH_HOSTS = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave|baidu|yandex)\./;
const SOCIAL_HOSTS =
  /(^|\.)(instagram|facebook|fb|tiktok|twitter|x|t|reddit|pinterest|linkedin|youtube|threads|nextdoor)\./;

/**
 * WHAT COUNTS AS A QUALIFYING TOUCH
 *
 * A touch qualifies when it carries an identifiable acquisition signal:
 *
 *   1. any UTM parameter is present, or
 *   2. `?ref=` is present (QR codes and sales-rep links use it), or
 *   3. there is a referrer from a domain that is not DropQ itself.
 *
 * An internal navigation does NOT qualify — otherwise every click inside the
 * site would overwrite last-touch with "drop-q.com" and the answer to "where
 * did this vendor come from?" would always be "us".
 *
 * A visit with no referrer and no parameters does not qualify EITHER, with one
 * exception: if there is no first touch yet, it is recorded as `direct` so that
 * first-touch is never empty. Someone who types the URL in did come from
 * somewhere, and "direct" is the honest name for not knowing where.
 */
export function qualifiesAsTouch(input: {
  params: Record<string, string>;
  referrerDomain: string | null;
  selfDomain: string | null;
  hasFirstTouch: boolean;
}): boolean {
  const { params, referrerDomain: ref, selfDomain, hasFirstTouch } = input;
  const hasUtm = Object.keys(params).some((k) => k.startsWith("utm_"));
  if (hasUtm || params.ref) return true;
  // `ref` has already been normalised to external-only by nextAttributionEdge.
  // The selfDomain comparison stays as a second line of defence for any future
  // caller that forgets.
  if (ref && ref !== selfDomain) return true;
  return !hasFirstTouch; // the honest `direct` first touch
}

/**
 * THE CANONICAL ATTRIBUTION PRECEDENCE.
 *
 * One function decides what channel a touch is. Nothing else in the system may
 * form its own opinion, because the whole point of a normalized channel is that
 * every report means the same thing by "social".
 *
 *   1. QR            `?ref=qr` or `utm_source=qr`. A scan is a scan even when
 *                    the link also carries campaign tags — it is the most
 *                    specific thing we know about how someone arrived.
 *   2. CAMPAIGN      any `utm_campaign` or `utm_source`. A tagged link is a
 *                    deliberate act of marketing and outranks whatever site the
 *                    browser happened to report, which is often wrong or absent.
 *   3. EXTERNAL      a referrer from a domain that is not ours, classified as
 *                    `search`, `social` or `referral`.
 *   4. DIRECT        nothing known. Includes internal navigation, because
 *                    DropQ is not its own referrer.
 *
 * WHAT THIS DOES NOT DECIDE. Vendor storefront attribution — which vendor
 * brought a CUSTOMER — is a different question with a different vocabulary
 * (`TouchSource` in lib/attribution.ts: storefront, drop, qr, dropmeet,
 * checkout, in_person, direct, admin) stored on `Customer.signupSource`. This
 * function's `TouchChannel` describes how a VISITOR reached the site at all and
 * is stored on `Seller.signupSource`. Two subjects, two vocabularies, neither
 * derived from the other — conflating them is how "storefront" ends up in a
 * marketing-channel report.
 *
 * THE FIELD SPLIT, unchanged and canonical:
 *   signupSource        normalized channel      "campaign"
 *   signupSourceDetail  the specific source     "activation" (raw utm_source,
 *                                                or the referrer domain)
 *   signupCampaign      the campaign            "first-check"
 */
export function touchChannel(params: Record<string, string>, ref: string | null): TouchChannel {
  if (params.ref === "qr" || params.utm_source === "qr") return "qr";
  if (params.utm_campaign || params.utm_source) return "campaign";
  if (!ref) return "direct";
  if (SEARCH_HOSTS.test(`.${ref}`)) return "search";
  if (SOCIAL_HOSTS.test(`.${ref}`)) return "social";
  return "referral";
}

export function buildTouch(input: {
  params: Record<string, string>;
  /** EXTERNAL referrer only — the caller must already have excluded our own. */
  referrerDomain: string | null;
  path: string;
  now?: Date;
}): AcquisitionTouch {
  const { params, referrerDomain: ref, path } = input;
  return {
    channel: touchChannel(params, ref),
    source: params.utm_source ?? params.ref ?? ref ?? null,
    referrerDomain: ref,
    medium: params.utm_medium ?? null,
    campaign: params.utm_campaign ?? null,
    content: params.utm_content ?? null,
    term: params.utm_term ?? null,
    path,
    at: (input.now ?? new Date()).toISOString(),
  };
}

/**
 * Merge a new touch into the cookie.
 *
 * FIRST-TOUCH IS PRESERVED, ALWAYS. That matches the doctrine already in the
 * product: `Customer.firstVendorId` is "written once and never overwritten",
 * and `dq_touch` is first-write-wins. A second rule for vendors would mean two
 * contradictory answers to "who brought them".
 */
export function mergeAttribution(
  existing: AttributionCookie | null,
  touch: AcquisitionTouch
): AttributionCookie {
  if (!existing) return { first: touch, last: touch };
  return { first: existing.first, last: touch };
}

export function parseAttribution(raw: string | null | undefined): AttributionCookie | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AttributionCookie;
    return parsed?.first?.at && parsed?.last?.at ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The attribution cookie's next value, or the existing one unchanged.
 *
 * Lives here rather than in the server writer because middleware runs on the
 * edge and cannot import a `server-only` module. One implementation, shared by
 * middleware, the sink and the tests.
 */
export function nextAttributionEdge(input: {
  existing: AttributionCookie | null;
  params: Record<string, string>;
  referrerDomain: string | null;
  selfDomain: string | null;
  path: string;
  now?: Date;
}): AttributionCookie | null {
  /**
   * DropQ is not its own referrer.
   *
   * Normalised here, once, before anything downstream sees it. Without this,
   * a visitor whose first analytics touch happened to be an internal navigation
   * was recorded as a `referral` from `drop-q.com` — which is what one real
   * production row said on the day analytics was switched on. Their true
   * channel is `direct`: we do not know where they came from, and saying
   * "ourselves" is worse than saying so.
   */
  const external =
    input.referrerDomain && input.referrerDomain !== input.selfDomain
      ? input.referrerDomain
      : null;

  const qualifies = qualifiesAsTouch({
    params: input.params,
    referrerDomain: external,
    selfDomain: input.selfDomain,
    hasFirstTouch: !!input.existing,
  });
  if (!qualifies) return input.existing;
  return mergeAttribution(
    input.existing,
    buildTouch({
      params: input.params,
      referrerDomain: external,
      path: input.path,
      now: input.now,
    })
  );
}
