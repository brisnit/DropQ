/**
 * Security response headers and the Content-Security-Policy.
 *
 * ONE SOURCE OF TRUTH. next.config.ts sends these; the self-test asserts them;
 * the browser suite checks them against a live server. Nothing else should
 * define a security header, so that "what does DropQ send?" has exactly one
 * answer and changing it means changing this file.
 *
 * ── WHERE THIS STAGE STOPS ────────────────────────────────────────────────
 *
 * The static headers below are ENFORCED. The CSP is REPORT-ONLY and is
 * expected to report violations from day one — Next emits ~21 inline
 * <script> blocks per page and `script-src 'self'` does not permit them.
 * Those reports are the evidence for the nonce work that comes next; they are
 * not a bug, and the policy must NOT be weakened with 'unsafe-inline' to
 * quiet them down. Report-Only blocks nothing, so nothing breaks meanwhile.
 *
 * Two directives behave differently under Report-Only and are worth knowing:
 * `upgrade-insecure-requests` is ignored entirely by the spec, and
 * `frame-ancestors` reports but does not block. Clickjacking protection in
 * this stage therefore comes from `X-Frame-Options: DENY`, which is enforced.
 */

/* ------------------------------------------------- third-party inventory -- */

/**
 * The exact Vercel Blob host serving vendor logos and product photos.
 *
 * PINNED ON PURPOSE, not wildcarded. The subdomain is this project's blob
 * store id, so `*.public.blob.vercel-storage.com` would also admit every other
 * Vercel customer's store. If the store is ever recreated this constant stops
 * matching, the self-test fails by name, and someone has to make a decision —
 * which is the intended outcome. Observed in production HTML on 31 Aug 2026,
 * in both an <img src> and an og:image.
 */
export const BLOB_HOST = "https://rsvjjuuoioqd578j.public.blob.vercel-storage.com";

/**
 * Every origin the BROWSER is allowed to reach, and why.
 *
 * Deliberately short. DropQ loads no third-party scripts at all: Stripe is
 * server-side only (`@stripe/stripe-js` is not a dependency), fonts are
 * self-hosted by next/font, and mapbox-gl is bundled rather than CDN-loaded.
 * An entry here is a claim that the browser genuinely contacts it — adding one
 * because a service exists somewhere in the stack is how allowlists rot.
 */
export const BROWSER_ORIGINS = {
  /** Vendor logos, product photos, og:image. */
  blob: BLOB_HOST,
  /** Map styles, tiles, sprites and glyphs for the DropMeet map. */
  mapboxApi: "https://api.mapbox.com",
  /** mapbox-gl telemetry. Fired automatically; blocking it degrades nothing. */
  mapboxEvents: "https://events.mapbox.com",
  /** Checkout Session redirect target. */
  stripeCheckout: "https://checkout.stripe.com",
  /** Billing Portal redirect target. */
  stripeBilling: "https://billing.stripe.com",
  /** Connect onboarding Account Links and Express login links. */
  stripeConnect: "https://connect.stripe.com",
  /** Auth.js Google sign-in redirect. */
  google: "https://accounts.google.com",
} as const;

/**
 * Origins that look plausible but must NEVER appear.
 *
 * Each is a mistake someone will eventually make, so the self-test asserts
 * their absence rather than trusting review to catch it.
 */
export const FORBIDDEN_ORIGINS = [
  // Stripe.js is not used — every Stripe surface is a server-side redirect.
  "https://js.stripe.com",
  "https://m.stripe.network",
  // next/font self-hosts at build time; nothing is fetched from Google.
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  // The POSTHOG env vars are set but no code references them.
  "https://app.posthog.com",
  "https://us.i.posthog.com",
  // Analytics is first-party, at /api/track.
  "https://www.google-analytics.com",
  "https://www.googletagmanager.com",
] as const;

/* ------------------------------------------------------- static headers -- */

/**
 * Browser capabilities, disabled unless the product actually uses them.
 *
 * `geolocation` is NOT disabled: components/discover-client.tsx calls
 * getCurrentPosition for "near me", and the DropMeet map adds a Mapbox
 * GeolocateControl. Disabling it would silently break both.
 *
 * `clipboard-write` backs the copy and share buttons; `fullscreen` is unused
 * today but left at (self) because the gain from forbidding it is negligible
 * and a future lightbox would fail in a way nobody would connect to this file.
 *
 * `payment=()` is safe: DropQ never touches the Payment Request API — the
 * browser is redirected to Stripe's own origin, which carries its own policy.
 */
export const PERMISSIONS_POLICY = [
  "geolocation=(self)",
  "clipboard-write=(self)",
  "fullscreen=(self)",
  "camera=()",
  "microphone=()",
  "payment=()",
  "usb=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "display-capture=()",
  "serial=()",
  "bluetooth=()",
  "interest-cohort=()",
  "browsing-topics=()",
].join(", ");

/**
 * Sent on every response.
 *
 * NOT HERE, DELIBERATELY:
 *
 *   Strict-Transport-Security — Vercel already sends max-age=63072000 on the
 *   custom domain. Setting our own would silently take ownership of a header
 *   that is currently correct, and `includeSubDomains` / `preload` are a
 *   separate decision with a separate blast radius.
 *
 *   Cross-Origin-Embedder-Policy — would require every cross-origin
 *   subresource to opt in via CORP or CORS. Vercel Blob images and Mapbox
 *   tiles do not, so require-corp breaks the map and every product photo.
 *   Nothing here needs cross-origin isolation: no SharedArrayBuffer, no
 *   WebAssembly, no threading.
 */
export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  {
    // Redundant with frame-ancestors on modern browsers, which ignore this
    // when a CSP carries frame-ancestors — but the CSP is Report-Only in this
    // stage, so THIS is the header actually preventing clickjacking today.
    key: "X-Frame-Options",
    value: "DENY",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  {
    // Safe because Google sign-in is a full-page redirect from a server
    // action, not a popup. If a popup OAuth flow is ever added this must
    // become same-origin-allow-popups or the popup loses its opener.
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    // cross-origin, NOT same-origin. lib/email.ts falls back to
    // https://www.drop-q.com/brand/dropq-logo.png, which a browser-based mail
    // client loads cross-origin; same-origin would block it.
    key: "Cross-Origin-Resource-Policy",
    value: "cross-origin",
  },
] as const;

/* ------------------------------------------------------------------ CSP -- */

/** Where violation reports go. First-party; no third-party collector. */
export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The candidate policy — as close to the eventual enforced policy as it can be
 * without nonces, so the reports we collect are evidence about the real thing.
 *
 * `script-src 'self'` with no 'unsafe-inline' is the whole point: Next's inline
 * scripts WILL report, and that report stream is what tells us the nonce
 * migration is complete when it goes quiet.
 *
 * `style-src-attr 'unsafe-inline'` is the one exception that will survive into
 * the enforced policy. A nonce cannot authorise a style ATTRIBUTE, and the app
 * emits ~26 of them per page (transition-delay, background-image, computed
 * colours), plus whatever mapbox-gl sets at runtime. It permits inline styles
 * only — never a script.
 *
 * No 'unsafe-eval' in any environment. mapbox-gl was checked and contains
 * neither `eval` nor `new Function`. React uses eval in DEVELOPMENT only, and
 * since this policy never blocks, a dev violation costs a report and nothing
 * else — so dev and production share one policy rather than drifting apart.
 */
export function buildCsp(): string {
  const { blob, mapboxApi, mapboxEvents, stripeCheckout, stripeBilling, stripeConnect, google } =
    BROWSER_ORIGINS;

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${blob} ${mapboxApi}`,
    "font-src 'self'",
    `connect-src 'self' ${mapboxApi} ${mapboxEvents}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    `form-action 'self' ${stripeCheckout} ${stripeBilling} ${stripeConnect} ${google}`,
    "base-uri 'self'",
    "object-src 'none'",
    "media-src 'self'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
    // report-uri, not report-to. Firefox and Safari implement no Reporting API
    // for CSP, so report-to would collect from Chrome only while report-uri
    // collects from everything — and shipping both makes Chrome send each
    // violation twice. The deprecation is on paper; support is universal.
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

/** Directives that must never carry a bare wildcard. Asserted in tests. */
export const CSP_HEADER_REPORT_ONLY = "Content-Security-Policy-Report-Only";
export const CSP_HEADER_ENFORCED = "Content-Security-Policy";
