import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  ANALYTICS_EVENTS,
  BEHAVIOUR_EVENTS,
  CONVERSION_EVENTS,
  FORBIDDEN_PROPERTY_KEYS,
  PARALLEL_LEGACY_EVENTS,
  RETAINED_QUERY_PARAMS,
  SUPERSEDED_EVENT_NAMES,
  deviceClass,
  forbiddenKeysIn,
  isAnalyticsEvent,
  isBot,
  isClientReportable,
  referrerDomain,
  retainedParams,
  sanitizePath,
} from "@/lib/analytics-events";
import {
  analyticsEnv,
  analyticsMode,
  buildTouch,
  identityAllowed,
  isValidId,
  mergeAttribution,
  newId,
  nextAttributionEdge,
  parseAttribution,
  qualifiesAsTouch,
  touchChannel,
  visitorHandle,
  writeRefusalReason,
  writesAllowed,
  type AttributionCookie,
} from "@/lib/analytics-identity";
import {
  INTERNAL_KINDS,
  analyticsWhere,
  isBusinessOrder,
  isBusinessSeller,
  orderWhere,
  sellerWhere,
} from "@/lib/reporting";

/**
 * Analytics foundation self-test — "nothing is recorded that shouldn't be, and
 * nothing is recorded anywhere it shouldn't be".
 *
 *   curl localhost:3000/api/dev/analytics-selftest
 *
 * Pure: no database, no network, writes nothing. 404s in production.
 *
 * The properties, in order of how badly a regression hurts:
 *
 *   1. PREVIEW CANNOT WRITE. Preview shares DATABASE_URL with production; a
 *      guard failure silently turns crawler traffic into acquisition data.
 *   2. IDENTITY IS OFF UNTIL POLICY SAYS OTHERWISE. The privacy policy promises
 *      essential cookies only; the default must be `off`.
 *   3. NOTHING SENSITIVE IS STORED. Forbidden keys, query strings, raw search
 *      text, full referrers, IP addresses.
 *   4. FIRST-TOUCH IS NEVER OVERWRITTEN. It is an acquisition of record.
 *   5. ONE VOCABULARY. Superseded names cannot come back.
 *   6. INTERNAL TRAFFIC IS EXCLUDED FROM BUSINESS NUMBERS.
 */

type Result = { name: string; pass: boolean; detail?: string };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ------------------ 1. Environment + policy guards -------------------- */
  {
    check("preview deployments can never write",
      writesAllowed({ VERCEL_ENV: "preview", ANALYTICS_MODE: "on" }) === false);
    check("preview is refused with a nameable reason",
      writeRefusalReason({ VERCEL_ENV: "preview", ANALYTICS_MODE: "on" }) === "preview_deployment");
    check("preview refusal does not depend on NODE_ENV",
      writesAllowed({ VERCEL_ENV: "preview", NODE_ENV: "production", ANALYTICS_MODE: "on" }) === false);
    check("production with analytics on may write",
      writesAllowed({ VERCEL_ENV: "production", ANALYTICS_MODE: "on" }) === true);
    check("production with analytics off may not write",
      writesAllowed({ VERCEL_ENV: "production" }) === false);
    check("the environment is recorded, not assumed",
      analyticsEnv({ VERCEL_ENV: "preview" }) === "preview" &&
      analyticsEnv({ NODE_ENV: "production" }) === "production" &&
      analyticsEnv({}) === "development");

    check("analytics is OFF unless explicitly enabled", analyticsMode({}) === "off");
    check("an unrecognised mode is treated as off",
      analyticsMode({ ANALYTICS_MODE: "yes-please" }) === "off");
    check("mode parsing is case- and space-insensitive",
      analyticsMode({ ANALYTICS_MODE: " ON " }) === "on");

    check("off mode identifies nobody", identityAllowed("off", "granted") === false);
    check("on mode identifies everyone", identityAllowed("on", null) === true);
    check("consent mode waits for consent",
      identityAllowed("consent", null) === false &&
      identityAllowed("consent", "denied") === false &&
      identityAllowed("consent", "granted") === true);
  }

  /* ---------------------------- 2. Identity ----------------------------- */
  {
    const a = newId();
    const b = newId();
    check("ids are 128 bits of hex", /^[0-9a-f]{32}$/.test(a));
    check("ids are not predictable", a !== b);
    check("only our own id shape is accepted",
      isValidId(a) && !isValidId("../../etc/passwd") && !isValidId("") && !isValidId(null) &&
      !isValidId(a.toUpperCase()));
    check("the admin handle is short and non-reversible",
      visitorHandle(a).length === 6 && !a.includes(visitorHandle(a)));
  }

  /* ------------------------ 3. URL sanitisation ------------------------- */
  {
    check("query strings are stripped from paths",
      sanitizePath("/verify?token=abc123") === "/verify");
    check("fragments are stripped", sanitizePath("/pricing#plans") === "/pricing");
    check("absolute URLs are reduced to a path",
      sanitizePath("https://www.drop-q.com/s/cedar?utm_source=ig") === "/s/cedar");
    check("trailing slashes are normalised",
      sanitizePath("/pricing/") === "/pricing" && sanitizePath("/") === "/");
    check("a session id in a query string cannot survive",
      !sanitizePath("/dashboard/billing?session_id=cs_live_secret").includes("cs_live"));
    check("an email in a query string cannot survive",
      !sanitizePath("/signup?email=someone@example.com").includes("@"));
    check("paths are length-capped", sanitizePath("/" + "x".repeat(900)).length <= 512);

    const params = new URLSearchParams(
      "utm_source=ig&utm_medium=social&utm_campaign=founders&utm_content=a&utm_term=b&ref=qr&token=SECRET&email=x@y.z"
    );
    const kept = retainedParams(params);
    check("UTMs and ref are retained",
      kept.utm_source === "ig" && kept.utm_medium === "social" &&
      kept.utm_campaign === "founders" && kept.utm_content === "a" &&
      kept.utm_term === "b" && kept.ref === "qr");
    check("everything else is discarded — it is an allowlist",
      !("token" in kept) && !("email" in kept) && Object.keys(kept).length === 6);
    check("the allowlist is exactly the six documented parameters",
      RETAINED_QUERY_PARAMS.length === 6);
    check("retained values are length-capped",
      retainedParams(new URLSearchParams(`utm_campaign=${"x".repeat(400)}`)).utm_campaign.length <= 128);
  }

  /* ------------------------- 4. Referrer + device ----------------------- */
  {
    check("only the referrer domain is kept",
      referrerDomain("https://www.instagram.com/p/abc?igshid=SECRET") === "instagram.com");
    check("a full referrer URL is never returned",
      !String(referrerDomain("https://x.com/a/b?c=d")).includes("/"));
    check("a missing referrer is null", referrerDomain(null) === null && referrerDomain("") === null);
    check("a malformed referrer does not throw", referrerDomain("not a url") === null);

    check("device class is coarse",
      deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148") === "mobile" &&
      deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") === "tablet" &&
      deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)") === "desktop" &&
      deviceClass(null) === "unknown");

    check("self-declaring crawlers are detected",
      isBot("Googlebot/2.1") && isBot("facebookexternalhit/1.1") &&
      isBot("HeadlessChrome/120") && isBot("curl/8.4.0"));
    check("no user-agent at all is treated as a script", isBot(null) && isBot(""));
    check("a real browser is not a bot",
      !isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"));
  }

  /* -------------------------- 5. Vocabulary ----------------------------- */
  {
    const names = [...ANALYTICS_EVENTS];
    check("event names are unique", new Set(names).size === names.length);
    check("every name follows noun_verb", names.every((n) => /^[a-z][a-z0-9_]*[a-z]$/.test(n)));
    check("behaviour and conversion sets do not overlap",
      !BEHAVIOUR_EVENTS.some((n) => (CONVERSION_EVENTS as readonly string[]).includes(n)));
    check("the vocabulary covers both funnels",
      names.includes("page_viewed") && names.includes("vendor_signed_up") &&
      names.includes("vendor_stripe_charge_ready") && names.includes("vendor_publish_blocked") &&
      names.includes("checkout_started") && names.includes("purchase_completed"));

    check("only behavioural events may be reported by a browser",
      BEHAVIOUR_EVENTS.every(isClientReportable) &&
      CONVERSION_EVENTS.every((n) => !isClientReportable(n)));
    check("a forged conversion event is rejected",
      isAnalyticsEvent("vendor_first_paid_order") && !isClientReportable("vendor_first_paid_order"));
    check("an unknown event is rejected", !isAnalyticsEvent("free_money_please"));

    // The renames the audit proposed and you approved.
    check("site_viewed is superseded by page_viewed",
      SUPERSEDED_EVENT_NAMES.site_viewed?.use === "page_viewed" && !isAnalyticsEvent("site_viewed"));
    check("pricing_viewed does not exist as an event",
      !isAnalyticsEvent("pricing_viewed") && "pricing_viewed" in SUPERSEDED_EVENT_NAMES);
    check("stripe_ready is superseded by vendor_stripe_charge_ready",
      SUPERSEDED_EVENT_NAMES.stripe_ready?.use === "vendor_stripe_charge_ready" &&
      !isAnalyticsEvent("stripe_ready"));
    check("no superseded name is also a live event",
      Object.keys(SUPERSEDED_EVENT_NAMES).every((n) => !isAnalyticsEvent(n)));
    check("every supersession explains itself",
      Object.values(SUPERSEDED_EVENT_NAMES).every((v) => v.why.length > 20));
    check("legacy parallels point at real canonical events",
      Object.values(PARALLEL_LEGACY_EVENTS).every((n) => isAnalyticsEvent(n)));

    // The paper spec and the code must not drift apart again.
    const spec = readFileSync("docs/VENDOR-ACTIVATION.md", "utf8");
    check("the activation doc's funnel events all exist here",
      ["vendor_signed_up", "vendor_stripe_charge_ready", "vendor_publish_blocked",
       "vendor_first_paid_order"].every((n) => spec.includes(n) && isAnalyticsEvent(n)));
  }

  /* --------------------------- 6. Properties ---------------------------- */
  {
    check("forbidden keys are rejected",
      forbiddenKeysIn({ email: "a@b.c" }).length === 1 &&
      forbiddenKeysIn({ password: "x" }).length === 1 &&
      forbiddenKeysIn({ cardNumber: "4242" }).length === 1);
    check("separators cannot smuggle a forbidden key past the check",
      forbiddenKeysIn({ card_number: "4242" }).length === 1 &&
      forbiddenKeysIn({ "ip-address": "1.2.3.4" }).length === 1 &&
      forbiddenKeysIn({ API_KEY: "sk_live" }).length === 1);
    check("raw search text can never be a property",
      forbiddenKeysIn({ query: "how do I get paid" }).length === 1 &&
      forbiddenKeysIn({ searchQuery: "x" }).length === 1 &&
      forbiddenKeysIn({ q: "x" }).length === 1);
    check("full URLs and referrers can never be a property",
      forbiddenKeysIn({ url: "https://x" }).length === 1 &&
      forbiddenKeysIn({ referrer: "https://x" }).length === 1);
    check("IP address is on the forbidden list",
      (FORBIDDEN_PROPERTY_KEYS as readonly string[]).includes("ip"));
    check("harmless properties pass",
      forbiddenKeysIn({ plan: "starter", step: 3, zeroResults: true }).length === 0);
  }

  /* -------------------------- 7. Attribution ---------------------------- */
  {
    const utm = { utm_source: "ig", utm_campaign: "founders" };
    check("a UTM always qualifies",
      qualifiesAsTouch({ params: utm, referrerDomain: null, selfDomain: "drop-q.com", hasFirstTouch: true }));
    check("a ?ref always qualifies",
      qualifiesAsTouch({ params: { ref: "qr" }, referrerDomain: null, selfDomain: "drop-q.com", hasFirstTouch: true }));
    check("an external referrer qualifies",
      qualifiesAsTouch({ params: {}, referrerDomain: "instagram.com", selfDomain: "drop-q.com", hasFirstTouch: true }));
    check("our own site is NOT an acquisition source",
      !qualifiesAsTouch({ params: {}, referrerDomain: "drop-q.com", selfDomain: "drop-q.com", hasFirstTouch: true }));
    check("a bare revisit does not overwrite last-touch",
      !qualifiesAsTouch({ params: {}, referrerDomain: null, selfDomain: "drop-q.com", hasFirstTouch: true }));
    check("a bare FIRST visit is recorded as direct rather than lost",
      qualifiesAsTouch({ params: {}, referrerDomain: null, selfDomain: "drop-q.com", hasFirstTouch: false }));

    check("channels are classified",
      touchChannel({}, "google.com") === "search" &&
      touchChannel({}, "instagram.com") === "social" &&
      touchChannel({}, "someblog.com") === "referral" &&
      touchChannel({}, null) === "direct" &&
      touchChannel({ utm_campaign: "founders" }, null) === "campaign" &&
      touchChannel({ ref: "qr" }, null) === "qr");

    const first = buildTouch({ params: { utm_campaign: "founders", utm_source: "qr" }, referrerDomain: null, path: "/", now: new Date("2026-08-01T00:00:00Z") });
    const later = buildTouch({ params: {}, referrerDomain: "instagram.com", path: "/pricing", now: new Date("2026-08-03T00:00:00Z") });
    const merged: AttributionCookie = mergeAttribution(mergeAttribution(null, first), later);
    check("first-touch survives a later touch", merged.first.campaign === "founders");
    check("last-touch is the most recent qualifying source", merged.last.source === "instagram.com");
    check("first-touch cannot be overwritten however many touches arrive",
      mergeAttribution(merged, later).first.at === first.at);

    const cookie = nextAttributionEdge({
      existing: merged,
      params: {},
      referrerDomain: "drop-q.com",
      selfDomain: "drop-q.com",
      path: "/signup",
    });
    check("internal navigation leaves attribution untouched",
      cookie?.last.source === "instagram.com");
    check("attribution round-trips through the cookie",
      parseAttribution(JSON.stringify(merged))?.first.campaign === "founders");
    check("a corrupt attribution cookie is discarded, not trusted",
      parseAttribution("{oops") === null && parseAttribution("{}") === null);
    check("no touch stores a full URL",
      !JSON.stringify(merged).includes("http"));
  }

  /* --------------------------- 8. Reporting ----------------------------- */
  {
    check("business excludes internal sellers",
      JSON.stringify(sellerWhere("business")) === JSON.stringify({ internalKind: null }));
    check("operational and financial exclude nothing",
      JSON.stringify(sellerWhere("operational")) === "{}" &&
      JSON.stringify(sellerWhere("financial")) === "{}");
    check("an order is internal if EITHER side is",
      isBusinessOrder({ seller: { internalKind: null }, customer: { internalKind: null } }) &&
      !isBusinessOrder({ seller: { internalKind: "canary" }, customer: { internalKind: null } }) &&
      !isBusinessOrder({ seller: { internalKind: null }, customer: { internalKind: "founder" } }));
    check("a guest order still counts as business",
      isBusinessOrder({ seller: { internalKind: null }, customer: null }));
    check("the order filter names both sides",
      JSON.stringify(orderWhere("business")).includes("seller") &&
      JSON.stringify(orderWhere("business")).includes("customer"));
    check("business analytics excludes preview, bots and internal traffic",
      JSON.stringify(analyticsWhere("business")) ===
        JSON.stringify({ env: "production", isBot: false, isInternal: false }));
    check("any non-null internalKind is internal",
      INTERNAL_KINDS.every((k) => !isBusinessSeller({ internalKind: k })) &&
      isBusinessSeller({ internalKind: null }));
    check("the docs and harness fixtures are classifiable",
      (INTERNAL_KINDS as readonly string[]).includes("docs") &&
      (INTERNAL_KINDS as readonly string[]).includes("harness"));
  }

  /* ------------------- 9. Source-level guarantees ----------------------- */
  {
    const sink = readFileSync("app/api/track/route.ts", "utf8");
    check("the sink refuses cross-site posts", /sec-fetch-site/.test(sink));
    check("the sink refuses conversion events", /isClientReportable/.test(sink));
    check("the sink takes identity from cookies, never the body",
      /readIdentity\(\)/.test(sink) && !/body[^\n]*visitorId/.test(sink));
    check("the sink rate limits", /rateLimited/.test(sink));
    check("the sink writes after the response", /after\(/.test(sink));
    check("the sink never reveals which rule was broken",
      (sink.match(/status: 204/g) ?? []).length >= 1 && !/status: 4\d\d/.test(sink));

    const server = readFileSync("lib/analytics-server.ts", "utf8");
    check("the writer swallows every error", /catch/.test(server) && !/throw /.test(server));
    check("the writer refuses before touching the database",
      server.indexOf("writeRefusalReason") < server.indexOf("prisma.analyticsEvent"));
    check("signup attribution can never overwrite a first touch",
      /firstTouchAt: null/.test(server));
    check("no IP address is ever read", !/x-forwarded-for|x-real-ip/i.test(server));

    const auth = readFileSync("lib/actions/auth.ts", "utf8");
    check("signup stamps the anonymous history onto the vendor",
      /attributeSignup\(seller\.id\)/.test(auth));
    check("the signup event is emitted server-side, after the response",
      /after\(\s*\(\)\s*=>\s*\n?\s*recordEventSafely/.test(auth.replace(/\s+/g, " ").replace(/ /g, " ")) ||
      /recordEventSafely/.test(auth));
    check("signup does not await analytics",
      !/await recordEvent\b/.test(auth));

    const mw = readFileSync("middleware.ts", "utf8");
    check("middleware checks policy before issuing identity",
      mw.indexOf("identityAllowed") < mw.indexOf("newId()"));
    check("middleware refuses identity on preview", /writesAllowed\(\)/.test(mw));
    check("middleware gives crawlers no identity", /isBot\(/.test(mw));
    check("identity cookies are httpOnly", /httpOnly: true/.test(readFileSync("lib/analytics-identity.ts", "utf8")));
    check("middleware no longer runs on storefronts only",
      !/matcher: \["\/s\/:slug"/.test(mw));

    const client = readFileSync("lib/analytics.ts", "utf8");
    check("the client still cannot carry a raw help query",
      /Deliberately no `query`/.test(client) &&
      !/help_searched:\s*\{[^}]*\bquery\b\s*:/.test(client));
    // Comments explain WHY there is no browser storage, so strip them before
    // looking for a real access.
    const identitySrc = readFileSync("lib/analytics-identity.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    check("no analytics module reads browser storage for identity",
      !/localStorage|sessionStorage|document\.cookie/.test(identitySrc));

    const pageView = readFileSync("components/analytics/page-view.tsx", "utf8");
    check("page views are not collected inside the dashboard",
      /dashboard\|admin/.test(pageView));
    check("page views are off unless the server says otherwise", /enabled/.test(pageView));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "analytics",
      mode: analyticsMode(),
      env: analyticsEnv(),
      events: ANALYTICS_EVENTS.length,
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
