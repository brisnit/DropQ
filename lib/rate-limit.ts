import "server-only";
import { createHmac } from "crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";

/**
 * Rate limiting for the authentication surface.
 *
 * WHY POSTGRES AND NOT AN IN-MEMORY MAP. The analytics sink
 * (app/api/track/route.ts) uses a per-instance Map, and that is the right call
 * there. It is the wrong call here. Vercel runs many concurrent instances and
 * freezes them constantly, so a Map-based limit is really `limit × instances`
 * and resets whenever a function is recycled — it loosens exactly when an
 * attack arrives. A counter has to be shared to mean anything, and Neon is
 * already a hard dependency, so no new infrastructure is required. That
 * analytics limiter is deliberately untouched.
 *
 * WHY TWO DIMENSIONS. One attacker rotating IPs against one account is stopped
 * by the email dimension. One host rotating emails is stopped by the IP
 * dimension. Either alone leaves an open door.
 *
 * WHAT IS NEVER STORED. Keys are HMAC-SHA256 of the raw value. The table can
 * answer "has this key been busy?" without becoming a log of who tried to sign
 * in from where — which matters both on principle and because we publish that
 * DropQ does not store IP addresses.
 *
 * NO ACCOUNT LOCKS. Nothing here writes to Seller, ever. Blocks live in this
 * table, expire on their own, and have no unlock step — otherwise anyone could
 * lock any vendor out by failing five logins on their behalf.
 */

/* ----------------------------------------------------------------- rules -- */

export type Dimension = "email" | "ip";

export type Limit = {
  dimension: Dimension;
  /** Attempts allowed inside the window. */
  max: number;
  windowMs: number;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Thresholds, as approved.
 *
 * The tight numbers are all on the EMAIL dimension, where the blast radius is
 * one account for one window. The IP ceilings sit well above plausible human
 * behaviour so a shared network — a co-working space, a market with one router,
 * an office — cannot trip them. Thirty *failed* logins in fifteen minutes from
 * one address is not a room full of people mistyping.
 */
export const RULES = {
  /** Consumed on FAILURE only; a correct password costs nothing. */
  login: [
    { dimension: "email", max: 5, windowMs: 15 * MIN },
    { dimension: "ip", max: 30, windowMs: 15 * MIN },
  ],
  signup: [
    { dimension: "email", max: 3, windowMs: HOUR },
    { dimension: "ip", max: 5, windowMs: HOUR },
    { dimension: "ip", max: 20, windowMs: DAY },
  ],
  magicLink: [
    { dimension: "email", max: 3, windowMs: 15 * MIN },
    { dimension: "email", max: 10, windowMs: DAY },
    { dimension: "ip", max: 15, windowMs: 15 * MIN },
  ],
  passwordReset: [
    { dimension: "email", max: 3, windowMs: HOUR },
    { dimension: "email", max: 10, windowMs: DAY },
    { dimension: "ip", max: 15, windowMs: HOUR },
  ],
  tokenVerify: [{ dimension: "ip", max: 30, windowMs: 15 * MIN }],
} as const satisfies Record<string, readonly Limit[]>;

export type RuleName = keyof typeof RULES;

/* --------------------------------------------------------------- switches -- */

/**
 * `RATE_LIMIT_MODE=off` disables limiting entirely.
 *
 * An emergency valve for a false-positive lockout, not a configuration knob.
 * Unset means ON — the safe default, so forgetting the variable protects
 * rather than exposes.
 *
 * ⚠️ Setting it in Vercel does NOT take effect until you redeploy. A running
 * deployment keeps the environment snapshot it was built with; this was
 * measured on a preview deployment in August and is written up in
 * docs/ANALYTICS-ACTIVATION.md §2.
 */
export function limiterEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.RATE_LIMIT_MODE ?? "").trim().toLowerCase() !== "off";
}

/* ------------------------------------------------------------------ keys -- */

const KEY_SECRET = () => process.env.SESSION_SECRET || "dropq-dev-secret";

/** Emails are compared case-insensitively everywhere else; keys must match. */
export function normalizeEmailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** HMAC so the table holds no raw address. Truncated — 128 bits is plenty. */
export function hashKey(dimension: Dimension, raw: string): string {
  return createHmac("sha256", KEY_SECRET())
    .update(`${dimension}:${raw}`)
    .digest("hex")
    .slice(0, 32);
}

/** Start of the fixed window containing `now`. */
export function windowStart(now: number, windowMs: number): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/* ------------------------------------------------------------- decisions -- */

export type Decision = {
  allowed: boolean;
  /** Which rule tripped, for logging. Never shown to a caller. */
  trippedBy?: string;
  retryAfterMs?: number;
};

const ALLOW: Decision = { allowed: true };

type Subject = { email?: string | null; ip?: string | null };

function keysFor(limit: Limit, subject: Subject): string | null {
  if (limit.dimension === "email") {
    const email = subject.email ? normalizeEmailKey(subject.email) : null;
    return email ? hashKey("email", email) : null;
  }
  // No IP means no IP dimension — never a shared "unknown" bucket, which the
  // first attacker would fill on everyone else's behalf.
  return subject.ip ? hashKey("ip", subject.ip) : null;
}

/**
 * Are any of this rule's limits already exceeded? Reads only.
 *
 * Used before a password is checked, so a blocked caller never reaches bcrypt.
 */
export async function peek(rule: RuleName, subject: Subject, now = Date.now()): Promise<Decision> {
  if (!limiterEnabled()) return ALLOW;
  try {
    for (const limit of RULES[rule] as readonly Limit[]) {
      const key = keysFor(limit, subject);
      if (!key) continue;
      const bucket = bucketName(rule, limit);
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        SELECT "count" FROM "RateLimit"
        WHERE "bucket" = ${bucket}
          AND "key" = ${key}
          AND "windowAt" = ${windowStart(now, limit.windowMs)}
        LIMIT 1`;
      const count = rows[0]?.count ?? 0;
      if (count >= limit.max) {
        return {
          allowed: false,
          trippedBy: bucket,
          retryAfterMs: windowStart(now, limit.windowMs).getTime() + limit.windowMs - now,
        };
      }
    }
    return ALLOW;
  } catch (e) {
    // FAIL OPEN. Every endpoint behind this limiter needs the same database to
    // do its real work, so an outage means auth is down regardless; failing
    // closed would only add a second way to be broken.
    console.error("[rate-limit] peek failed, allowing:", e instanceof Error ? e.message : e);
    return ALLOW;
  }
}

/**
 * Count one attempt against every limit in the rule, then report whether any is
 * now exceeded.
 *
 * ⚠️ ALWAYS INCREMENTS, whether or not the account exists. That is what stops
 * the limiter becoming a better account oracle than the one it replaced: an
 * unknown email must consume budget exactly like a real one.
 */
export async function consume(rule: RuleName, subject: Subject, now = Date.now()): Promise<Decision> {
  if (!limiterEnabled()) return ALLOW;
  let decision: Decision = ALLOW;
  try {
    for (const limit of RULES[rule] as readonly Limit[]) {
      const key = keysFor(limit, subject);
      if (!key) continue;
      const bucket = bucketName(rule, limit);
      const at = windowStart(now, limit.windowMs);
      const expiresAt = new Date(at.getTime() + limit.windowMs);

      // One statement, atomic at the database. Two requests landing together
      // cannot read-then-write over each other, which a SELECT-then-UPDATE in
      // application code would allow — and losing counts is precisely how a
      // brute-force gets through.
      const rows = await prisma.$queryRaw<{ count: number }[]>`
        INSERT INTO "RateLimit" ("id", "bucket", "key", "windowAt", "count", "expiresAt")
        VALUES (gen_random_uuid()::text, ${bucket}, ${key}, ${at}, 1, ${expiresAt})
        ON CONFLICT ("bucket", "key", "windowAt")
        DO UPDATE SET "count" = "RateLimit"."count" + 1
        RETURNING "count"`;
      const count = rows[0]?.count ?? 1;
      if (count > limit.max && decision.allowed) {
        decision = {
          allowed: false,
          trippedBy: bucket,
          retryAfterMs: at.getTime() + limit.windowMs - now,
        };
      }
    }
    return decision;
  } catch (e) {
    console.error("[rate-limit] consume failed, allowing:", e instanceof Error ? e.message : e);
    return ALLOW;
  }
}

function bucketName(rule: RuleName, limit: Limit): string {
  return `${rule}:${limit.dimension}:${limit.windowMs}`;
}

/* --------------------------------------------------------------- helpers -- */

/** The caller's IP, or null. Never throws — a limiter must not break a page. */
export async function requestIp(): Promise<string | null> {
  try {
    return clientIp(await headers());
  } catch {
    return null;
  }
}

/**
 * Delete windows that have closed.
 *
 * Called from the existing reminders cron rather than adding a second schedule.
 * Indexed on `expiresAt`, so it stays a cheap range delete however large the
 * table gets.
 */
export async function purgeExpiredRateLimits(now = new Date()): Promise<number> {
  try {
    const { count } = await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  } catch (e) {
    console.error("[rate-limit] purge failed:", e instanceof Error ? e.message : e);
    return 0;
  }
}
