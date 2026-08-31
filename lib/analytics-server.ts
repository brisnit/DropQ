import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import {
  deviceClass,
  forbiddenKeysIn,
  isAnalyticsEvent,
  isBot,
  referrerDomain,
  retainedParams,
  sanitizePath,
  type AnalyticsEventName,
} from "@/lib/analytics-events";
import {
  analyticsEnv,
  analyticsMode,
  ATTRIBUTION_COOKIE,
  identityAllowed,
  isValidId,
  parseAttribution,
  nextAttributionEdge,
  SESSION_COOKIE,
  VISITOR_COOKIE,
  CONSENT_COOKIE,
  writeRefusalReason,
  writesAllowed,
  type AttributionCookie,
} from "@/lib/analytics-identity";

/**
 * Writing analytics events.
 *
 * THREE PROPERTIES THIS MODULE MUST HAVE, in priority order:
 *
 *   1. It never breaks anything. Every path is wrapped, every failure is
 *      swallowed, and a caller cannot tell whether the write succeeded. An
 *      analytics outage must not be able to stop a signup or a checkout.
 *   2. It never blocks. Callers pass this to `after()` so the response is
 *      already on its way before the insert runs.
 *   3. It never stores what it was told not to. Sanitisation happens here, once,
 *      rather than at each call site where it can be forgotten.
 *
 * Everything else — accuracy, completeness, timeliness — is subordinate to
 * those three. A lost event costs a row in a chart. A blocked checkout costs a
 * vendor money.
 */

/* -------------------------------------------------------------------------- */
/*  Reading identity                                                          */
/* -------------------------------------------------------------------------- */

export type RequestIdentity = {
  visitorId: string | null;
  sessionId: string | null;
  attribution: AttributionCookie | null;
};

/**
 * Whatever identity this request carries. Never creates one — middleware issues
 * the cookies, and only when policy allows it.
 */
export async function readIdentity(): Promise<RequestIdentity> {
  try {
    const jar = await cookies();
    const visitorId = jar.get(VISITOR_COOKIE)?.value ?? null;
    const sessionId = jar.get(SESSION_COOKIE)?.value ?? null;
    return {
      visitorId: isValidId(visitorId) ? visitorId : null,
      sessionId: isValidId(sessionId) ? sessionId : null,
      attribution: parseAttribution(jar.get(ATTRIBUTION_COOKIE)?.value),
    };
  } catch {
    return { visitorId: null, sessionId: null, attribution: null };
  }
}

/** Is identity permitted for this request under the current policy? */
export async function identityPermitted(): Promise<boolean> {
  try {
    const jar = await cookies();
    return identityAllowed(analyticsMode(), jar.get(CONSENT_COOKIE)?.value ?? null);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                   */
/* -------------------------------------------------------------------------- */

export type RecordInput = {
  name: AnalyticsEventName;
  /** Overrides the request path — a server event knows where it happened. */
  path?: string;
  sellerId?: string | null;
  customerId?: string | null;
  dropId?: string | null;
  props?: Record<string, unknown>;
  /** Set when the acting seller/customer is DropQ-controlled. */
  isInternal?: boolean;
  /** Supplied by the sink, which already parsed the beacon. */
  identity?: RequestIdentity;
  /** Supplied by the sink for a beacon; otherwise read from the request. */
  userAgent?: string | null;
  search?: URLSearchParams | null;
  isBot?: boolean;
};

export type RecordResult =
  | { written: true; id: string }
  | { written: false; reason: string };

/**
 * Record one event. Returns why it did not write rather than throwing.
 *
 * The return value exists for tests and for the self-test. Product code should
 * ignore it — see property 1.
 */
export async function recordEvent(input: RecordInput): Promise<RecordResult> {
  try {
    const refusal = writeRefusalReason();
    if (refusal) return { written: false, reason: refusal };

    if (!isAnalyticsEvent(input.name)) {
      return { written: false, reason: "unknown_event" };
    }

    const identity = input.identity ?? (await readIdentity());
    // No identity means either policy says no, or this is a request that never
    // passed through middleware. Either way there is nothing to attach an event
    // to, and an event with an invented visitor id is worse than no event.
    if (!identity.visitorId || !identity.sessionId) {
      return { written: false, reason: "no_identity" };
    }

    const props = input.props ?? {};
    const forbidden = forbiddenKeysIn(props);
    if (forbidden.length) {
      // Loud in development, silent in production — a developer should find out
      // immediately, a vendor should never see anything.
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[analytics] dropped "${input.name}": forbidden props ${forbidden.join(", ")}`);
      }
      return { written: false, reason: `forbidden_props:${forbidden.join(",")}` };
    }

    let userAgent = input.userAgent ?? null;
    let path = input.path ?? null;
    if (userAgent === null || path === null) {
      try {
        const h = await headers();
        userAgent ??= h.get("user-agent");
        path ??= h.get("x-invoke-path") ?? "/";
      } catch {
        /* not in a request scope — keep whatever the caller gave us */
      }
    }

    const params = input.search ? retainedParams(input.search) : {};
    const touch = identity.attribution;

    await prisma.analyticsEvent.create({
      data: {
        name: input.name,
        visitorId: identity.visitorId,
        sessionId: identity.sessionId,
        sellerId: input.sellerId ?? null,
        customerId: input.customerId ?? null,
        dropId: input.dropId ?? null,
        path: sanitizePath(path ?? "/"),
        /**
         * THE EXTERNAL DOMAIN THAT REFERRED THIS VISITOR INTO DROPQ, or null.
         *
         * Read from the attribution cookie, which middleware wrote from the
         * DOCUMENT request's Referer with our own domain already excluded.
         *
         * Explicitly NOT the request's own Referer header. A `page_viewed`
         * arrives as a beacon POST from the page being viewed, so its Referer
         * is always a drop-q.com URL; a server action's Referer is the page
         * that submitted it. Reading either recorded "drop-q.com referred this
         * visitor to drop-q.com" on every single row — which it did, on the
         * first day of live collection.
         */
        referrerDomain: touch?.last.referrerDomain ?? null,
        // Prefer the URL's own UTMs; fall back to the campaign that brought this
        // visitor, so a conversion event carries its acquisition without the
        // dashboard having to walk backwards through the session.
        utmSource: params.utm_source ?? touch?.last.source ?? null,
        utmMedium: params.utm_medium ?? touch?.last.medium ?? null,
        utmCampaign: params.utm_campaign ?? touch?.last.campaign ?? null,
        utmContent: params.utm_content ?? touch?.last.content ?? null,
        utmTerm: params.utm_term ?? touch?.last.term ?? null,
        device: deviceClass(userAgent),
        env: analyticsEnv(),
        isBot: input.isBot ?? isBot(userAgent),
        isInternal: input.isInternal ?? false,
        props: Object.keys(props).length ? (props as object) : undefined,
      },
      select: { id: true },
    });
    return { written: true, id: "ok" };
  } catch (e) {
    // Property 1. Nothing above this line may reach the caller.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[analytics] write failed:", e instanceof Error ? e.message : e);
    }
    return { written: false, reason: "error" };
  }
}

/**
 * Fire-and-forget wrapper for product code.
 *
 * Callers wrap this in `after()` so it runs once the response has been sent.
 * It returns void: there is deliberately nothing to await and nothing to check,
 * because the one thing a caller must never do is make a decision based on
 * whether analytics worked.
 */
export function recordEventSafely(input: RecordInput): void {
  void recordEvent(input).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/*  Anonymous → Seller                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Stamp a new vendor with the anonymous history that produced them.
 *
 * Called from `signupAction` immediately after the Seller row exists. This is
 * the join that makes the whole feature worth building: it is what turns
 * "someone visited from the AI Founders QR" into "that visit became this
 * vendor two days later".
 *
 * FIRST-TOUCH IS NEVER OVERWRITTEN. The `firstTouchAt: null` guard means a
 * second call — a retry, a double submit, a later backfill — cannot rewrite an
 * acquisition. Last-touch is written in the same statement because the two are
 * only meaningful together.
 *
 * Fails silently. A vendor's signup must not depend on their cookies.
 */
export async function attributeSignup(sellerId: string): Promise<void> {
  try {
    if (!writesAllowed()) return;
    const { visitorId, attribution } = await readIdentity();
    if (!visitorId || !attribution) return;

    await prisma.seller.updateMany({
      where: { id: sellerId, firstTouchAt: null },
      data: {
        firstTouchVisitorId: visitorId,
        firstTouchAt: new Date(attribution.first.at),
        signupSource: attribution.first.channel,
        signupSourceDetail: attribution.first.source,
        signupCampaign: attribution.first.campaign,
        lastTouchSource: attribution.last.channel,
        lastTouchCampaign: attribution.last.campaign,
      },
    });
  } catch {
    /* never block signup */
  }
}

/* -------------------------------------------------------------------------- */
/*  Touch building, shared with middleware                                    */
/* -------------------------------------------------------------------------- */

/**
 * Compute the attribution cookie for a request, from a full URLSearchParams.
 *
 * A thin adapter over `nextAttributionEdge` — the real logic lives in the pure
 * module so middleware can reach it. This exists so server callers do not have
 * to remember to run `retainedParams` first.
 */
export function nextAttribution(input: {
  existing: AttributionCookie | null;
  search: URLSearchParams;
  referrer: string | null;
  selfDomain: string | null;
  path: string;
  now?: Date;
}): AttributionCookie | null {
  return nextAttributionEdge({
    existing: input.existing,
    params: retainedParams(input.search),
    referrerDomain: referrerDomain(input.referrer),
    selfDomain: input.selfDomain,
    path: sanitizePath(input.path),
    now: input.now,
  });
}
