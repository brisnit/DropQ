import { NextResponse, type NextRequest } from "next/server";
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_MAX_AGE,
  CONSENT_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  VISITOR_COOKIE,
  VISITOR_MAX_AGE,
  analyticsMode,
  cookieOptions,
  identityAllowed,
  isValidId,
  newId,
  parseAttribution,
  writesAllowed,
  nextAttributionEdge,
} from "@/lib/analytics-identity";
import { isBot, referrerDomain, retainedParams, sanitizePath } from "@/lib/analytics-events";

/**
 * Two jobs, both of which have to happen before the page renders and neither of
 * which a page can do for itself.
 *
 *   1. FIRST-TOUCH VENDOR ATTRIBUTION (original). Which vendor brought a
 *      customer to DropQ. Storefront routes only.
 *   2. ANONYMOUS VISITOR IDENTITY (Phase A). Who is browsing, grouped across
 *      pages and sessions, so "visited but never signed up" is answerable.
 *
 * Both live here for the same reason: `cookies().set()` only works in a Server
 * Function or Route Handler, so a page attempting it silently no-ops.
 * Middleware sets cookies on the response and runs first.
 *
 * ⚠️ EDGE RUNTIME. No Prisma, no Node APIs, no `server-only` imports. Everything
 * this file uses comes from lib/analytics-identity.ts and lib/analytics-events.ts,
 * which are pure for exactly this reason.
 *
 * ⚠️ IDENTITY IS OFF BY DEFAULT. `ANALYTICS_MODE` is unset in every environment
 * today, so this sets no analytics cookie at all. The privacy policy promises
 * essential cookies only; flipping that promise is a policy decision, made in
 * one environment variable, not a consequence of deploying this code.
 */

const TOUCH_COOKIE = "dq_touch";
const TOUCH_MAX_AGE = 60 * 60 * 24 * 30; // 30 days to convert

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const secure = process.env.NODE_ENV === "production";

  vendorFirstTouch(request, response, secure);
  visitorIdentity(request, response, secure);

  return response;
}

/* -------------------------------------------------------------------------- */
/*  1. Vendor attribution — unchanged behaviour                               */
/* -------------------------------------------------------------------------- */

/**
 * Which vendor brought this customer. Storefront and drop pages only.
 *
 * Middleware is edge with no Prisma, so the cookie stores the vendor *slug*
 * straight off the URL; lib/attribution.ts resolves it to a seller id later.
 *
 * First write wins for the cookie's lifetime: someone who arrives through
 * vendor A and later browses vendor B is still A's acquisition.
 */
function vendorFirstTouch(request: NextRequest, response: NextResponse, secure: boolean) {
  if (request.cookies.has(TOUCH_COOKIE)) return;

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  // /s/<slug>            → storefront
  // /s/<slug>/<dropId>   → a specific drop
  if (segments[0] !== "s" || !segments[1]) return;

  const vendorSlug = segments[1];
  const dropId = segments[2] ?? null;

  // ?ref= / ?utm_source= tell us how the link was shared (QR, IG, text).
  const ref = request.nextUrl.searchParams.get("ref");
  const utm = request.nextUrl.searchParams.get("utm_source");
  const source = dropId ? "drop" : "storefront";

  response.cookies.set(
    TOUCH_COOKIE,
    JSON.stringify({
      vendorSlug,
      dropId,
      source: ref === "qr" || utm === "qr" ? "qr" : source,
      detail: ref ?? utm ?? null,
      at: new Date().toISOString(),
    }),
    cookieOptions(TOUCH_MAX_AGE, secure)
  );
}

/* -------------------------------------------------------------------------- */
/*  2. Anonymous visitor identity                                             */
/* -------------------------------------------------------------------------- */

function visitorIdentity(request: NextRequest, response: NextResponse, secure: boolean) {
  const mode = analyticsMode();
  const consent = request.cookies.get(CONSENT_COOKIE)?.value ?? null;

  // Policy first. In `off` there is nothing to clean up because nothing was
  // ever set; in `consent` the cookies appear the moment consent is granted.
  if (!identityAllowed(mode, consent)) return;

  // Preview shares DATABASE_URL with production. Nothing it does can reach the
  // events table, so there is no reason to mark its visitors either.
  if (!writesAllowed()) return;

  // Crawlers get no identity. They would otherwise be the majority of
  // "visitors" and make the top-of-funnel number meaningless.
  if (isBot(request.headers.get("user-agent"))) return;

  const existingVisitor = request.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = isValidId(existingVisitor) ? existingVisitor : newId();

  const existingSession = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionId = isValidId(existingSession) ? existingSession : newId();

  // The visitor cookie is re-set on every request so its 12 months roll forward
  // with use; the session cookie's 30 minutes slide the same way, which is what
  // makes a sitting end 30 minutes after the LAST page rather than the first.
  response.cookies.set(VISITOR_COOKIE, visitorId, cookieOptions(VISITOR_MAX_AGE, secure));
  response.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(SESSION_MAX_AGE, secure));

  const updated = nextAttributionEdge({
    existing: parseAttribution(request.cookies.get(ATTRIBUTION_COOKIE)?.value),
    params: retainedParams(request.nextUrl.searchParams),
    referrerDomain: referrerDomain(request.headers.get("referer")),
    selfDomain: referrerDomain(request.nextUrl.origin),
    path: sanitizePath(request.nextUrl.pathname),
  });
  if (updated) {
    response.cookies.set(
      ATTRIBUTION_COOKIE,
      JSON.stringify(updated),
      cookieOptions(ATTRIBUTION_MAX_AGE, secure)
    );
  }
}

export const config = {
  /**
   * Public, human-facing routes.
   *
   * Was storefronts only, which is why nobody could tell how many people looked
   * at the marketing site and left. The negative lookahead keeps middleware off
   * API routes, Next's own assets, and files with an extension — an identity
   * cookie on a favicon request is noise, and running middleware on every
   * static asset is latency for nothing.
   */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|brand|help/.*\\.png|.*\\..*).*)"],
};
