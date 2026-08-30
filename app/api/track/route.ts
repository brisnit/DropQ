import { after } from "next/server";
import {
  isAnalyticsEvent,
  isClientReportable,
  forbiddenKeysIn,
  isBot,
  sanitizePath,
} from "@/lib/analytics-events";
import { recordEvent, readIdentity } from "@/lib/analytics-server";
import { writeRefusalReason } from "@/lib/analytics-identity";

/**
 * The analytics sink.
 *
 * Was 18 lines that `console.log`ged and returned 204 — which is why nothing
 * anyone has ever done in DropQ was recorded. Now it writes, and because it
 * writes, it needs everything below.
 *
 * THIS IS A PUBLIC, UNAUTHENTICATED ENDPOINT. Anyone can POST to it. Four
 * defences, each stopping a different attack:
 *
 *   1. SAME-ORIGIN ONLY. A beacon from our own pages carries `sec-fetch-site:
 *      same-origin`. Cross-site posts are refused.
 *   2. BEHAVIOURAL EVENTS ONLY. `vendor_first_paid_order` cannot be reported
 *      over HTTP by anyone, ever — conversion events come from the server
 *      transition that makes them true. Without this rule the endpoint is a way
 *      to manufacture a funnel.
 *   3. IDENTITY MUST BE OURS. The visitor id comes from the httpOnly cookie the
 *      middleware issued, never from the request body. A caller cannot choose
 *      who they are.
 *   4. RATE LIMITED per visitor. A page view every few seconds is a person; two
 *      hundred a minute is a script.
 *
 * It always answers 204. Telling a prober which of the four rules it broke
 * would help them get past the others, and a beacon has nobody to read a body
 * anyway.
 */

/** Max events per visitor per window. A real session lands nowhere near this. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/**
 * In-memory, per-instance rate limiting.
 *
 * Deliberately not Redis: this is one guard against a bored person with curl,
 * not a distributed defence, and a serverless instance holding a Map costs
 * nothing. A determined attacker spreading across instances gets through — and
 * would still only be able to write `page_viewed` rows tagged with a visitor id
 * they cannot forge, which the dashboard's bot and internal filters already
 * treat with suspicion.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(visitorId: string, now = Date.now()): boolean {
  const entry = hits.get(visitorId);
  if (!entry || now > entry.resetAt) {
    hits.set(visitorId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    // Opportunistic sweep so the Map cannot grow without bound on a
    // long-lived instance.
    if (hits.size > 5_000) {
      for (const [key, value] of hits) if (now > value.resetAt) hits.delete(key);
    }
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

const NO_CONTENT = () => new Response(null, { status: 204 });

export async function POST(request: Request) {
  try {
    // Cheapest checks first — a refused request should cost nothing.
    if (writeRefusalReason()) return NO_CONTENT();

    const site = request.headers.get("sec-fetch-site");
    // `sendBeacon` sets same-origin. Absent means an old browser or a script;
    // "none" means the address bar. Neither is one of our pages.
    if (site && site !== "same-origin") return NO_CONTENT();

    const userAgent = request.headers.get("user-agent");
    if (isBot(userAgent)) return NO_CONTENT();

    const identity = await readIdentity();
    if (!identity.visitorId || !identity.sessionId) return NO_CONTENT();
    if (rateLimited(identity.visitorId)) return NO_CONTENT();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NO_CONTENT();

    const name = String((body as { event?: unknown }).event ?? "");
    if (!isAnalyticsEvent(name) || !isClientReportable(name)) {
      // Legacy discovery / DropMeet / guidance events keep the behaviour they
      // have always had: one compact line in the Vercel log, nothing stored.
      // They are not part of the canonical funnel vocabulary and are not
      // silently promoted into it — see PARALLEL_LEGACY_EVENTS. Deciding which
      // of them deserve storage is Phase B's problem, not this endpoint's.
      if (name && name.length < 64) {
        console.log(`[legacy] ${name}`, JSON.stringify((body as { props?: unknown }).props ?? {}));
      }
      return NO_CONTENT();
    }

    const rawProps = (body as { props?: unknown }).props;
    const props =
      rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)
        ? (rawProps as Record<string, unknown>)
        : {};
    if (forbiddenKeysIn(props).length) return NO_CONTENT();
    // A props bag is a handful of small values, not a payload.
    if (Object.keys(props).length > 12) return NO_CONTENT();

    const path = sanitizePath(String((body as { path?: unknown }).path ?? "/"));

    // `after()` so the beacon's 204 is already on its way. The browser is
    // usually mid-navigation when this fires; it must not wait for a write.
    after(() =>
      recordEvent({
        name,
        path,
        props,
        identity,
        userAgent,
        referrer: request.headers.get("referer"),
        isBot: false,
      })
    );

    return NO_CONTENT();
  } catch {
    // A malformed beacon is not an error worth reporting to anyone.
    return NO_CONTENT();
  }
}
