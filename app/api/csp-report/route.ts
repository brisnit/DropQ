import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp } from "@/lib/client-ip";
import { consume } from "@/lib/rate-limit";
import { cspExpiryFrom, normalizeDocumentPath, sanitizePathname } from "@/lib/csp-reports";

/**
 * CSP violation collector. First-party — no third-party vendor.
 *
 * ── WHAT THIS ENDPOINT IS ─────────────────────────────────────────────────
 *
 * A public, unauthenticated write. Anyone on the internet can POST to it,
 * because that is what a browser does when a policy is violated. Everything
 * below follows from taking that seriously.
 *
 * ── WHAT IS NEVER STORED ──────────────────────────────────────────────────
 *
 * No IP address. No cookies. No request headers. No user agent. No query
 * strings or fragments. No `script-sample` — a browser will happily send a
 * fragment of the offending script, and on a form page that could be anything
 * a person typed. No `original-policy`, `referrer` or `status-code`.
 *
 * Fields are ALLOWLISTED, not filtered: an unknown key is dropped rather than
 * stored, so a future browser adding a field cannot start leaking it into our
 * database without someone editing this file. DropQ publishes that it does not
 * store IP addresses, and a violation reporter is exactly the kind of endpoint
 * where that promise quietly gets broken.
 *
 * ── WHY IT CANNOT HURT THE APP ────────────────────────────────────────────
 *
 * It always answers 204, whatever happened inside. A full disk, a dead
 * database, a malformed body, a flood — all produce the same empty success.
 * Reporting is advisory: it must never influence a page render, a checkout, or
 * anything a person is trying to do. Nothing in the application imports this
 * module, so it cannot affect a request that does not target it.
 */

/** Reports are small. Anything larger is not a browser being helpful. */
const MAX_BYTES = 16 * 1024;

/** Column ceilings — a report is evidence, not free storage.
 *  The path ceiling lives in lib/csp-reports.ts, alongside the normaliser. */
const MAX_DIRECTIVE = 64;
const MAX_URI = 256;

/**
 * `blocked-uri` is sometimes a keyword rather than a URL. These are the ones
 * browsers actually send; anything else is treated as a URL and reduced.
 */
const BLOCKED_KEYWORDS = new Set(["inline", "eval", "data", "blob", "self", "wasm-eval", "unsafe-eval"]);

const NOOP = new Response(null, { status: 204 });

export async function POST(req: NextRequest) {
  try {
    // Cheap rejections first, before the body is read into memory.
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) return NOOP;

    const gate = await consume("cspReport", { ip: clientIp(req.headers) });
    if (!gate.allowed) return NOOP;

    const raw = await req.text();
    if (!raw || raw.length > MAX_BYTES) return NOOP;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NOOP; // a malformed body is not an error worth surfacing
    }

    for (const report of extractReports(parsed)) {
      const row = sanitize(report);
      if (row) await store(row);
    }
    return NOOP;
  } catch (e) {
    // FAIL OPEN, loudly in the log and silently to the caller. There is no
    // failure of this endpoint that should ever become a person's problem.
    console.error("[csp-report] ingest failed:", e instanceof Error ? e.message : e);
    return NOOP;
  }
}

/** A CSP report body, in whichever shape the browser used. */
type RawReport = Record<string, unknown>;

/**
 * Browsers send two shapes.
 *
 *   report-uri (what our policy asks for): {"csp-report": { "document-uri": … }}
 *   Reporting API: [{ "type": "csp-violation", "body": { "documentURL": … }}]
 *
 * The policy only declares `report-uri`, but the second shape is handled too:
 * it is ten lines, and a browser that decides to send it should not have its
 * reports silently dropped.
 */
function extractReports(parsed: unknown): RawReport[] {
  if (Array.isArray(parsed)) {
    return parsed
      .filter((r): r is RawReport => isObject(r))
      .map((r) => (isObject(r.body) ? (r.body as RawReport) : r))
      .slice(0, 32); // a batch is a batch, not an unbounded loop
  }
  if (isObject(parsed)) {
    const legacy = (parsed as RawReport)["csp-report"];
    if (isObject(legacy)) return [legacy as RawReport];
    return [parsed as RawReport];
  }
  return [];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Read one of several spellings of the same field. Never a wildcard read. */
function pick(r: RawReport, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickInt(r: RawReport, ...keys: string[]): number {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.min(Math.trunc(v), 1_000_000);
    if (typeof v === "string" && /^\d{1,7}$/.test(v)) return Number(v);
  }
  return 0;
}

type Row = {
  documentPath: string;
  effectiveDirective: string;
  blockedUri: string;
  sourceFile: string;
  lineNumber: number;
  columnNumber: number;
  disposition: string;
};

/**
 * Build the row, taking only the allowlisted fields and reducing every URL.
 *
 * Returns null when there is nothing usable — a report with no directive tells
 * us nothing, and storing it would only add noise to the queue we are meant to
 * be reading.
 */
function sanitize(r: RawReport): Row | null {
  const effectiveDirective = pick(r, "effective-directive", "effectiveDirective", "violated-directive", "violatedDirective")
    .split(/\s+/)[0]
    .slice(0, MAX_DIRECTIVE);
  if (!effectiveDirective) return null;

  const documentPath = toPath(pick(r, "document-uri", "documentURL", "documentUri"));
  const blockedRaw = pick(r, "blocked-uri", "blockedURL", "blockedUri");
  const disposition = pick(r, "disposition") === "enforce" ? "enforce" : "report";

  return {
    documentPath: documentPath || "/",
    effectiveDirective,
    blockedUri: toBlocked(blockedRaw).slice(0, MAX_URI),
    sourceFile: toReference(pick(r, "source-file", "sourceFile")).slice(0, MAX_URI),
    lineNumber: pickInt(r, "line-number", "lineNumber"),
    columnNumber: pickInt(r, "column-number", "columnNumber"),
    disposition,
  };
}

/**
 * A document URL reduced to its ROUTE PATTERN.
 *
 * `/s/britts-bunnies` becomes `/s/[slug]`, `/order/cmth…` becomes `/order/[id]`,
 * and — the one that actually matters — `/pay/<live token>` becomes
 * `/pay/[token]`. Stripping the query would not have saved that last one,
 * because the walk-up payment token is a PATH SEGMENT.
 *
 * It also bounds the table: rows are counted per route rather than per
 * storefront, per order and per visitor, so the row count stops tracking
 * traffic and content. And it is the better answer anyway — what you want to
 * know is which route violates the policy, not which storefront happened to be
 * open when it did.
 */
function toPath(value: string): string {
  if (!value) return "";
  return normalizeDocumentPath(value);
}

/**
 * `blocked-uri`: a keyword as-is, a cross-origin URL reduced to its origin, a
 * same-origin URL reduced to its path.
 *
 * The origin is what a policy decision is made about; the rest of a
 * third-party URL is somebody else's business and occasionally carries an
 * identifier we have no reason to hold.
 */
function toBlocked(value: string): string {
  if (!value) return "";
  const lower = value.toLowerCase();
  if (BLOCKED_KEYWORDS.has(lower)) return lower;
  return toReference(value);
}

/**
 * Same reduction, used for both blocked-uri and source-file.
 *
 * ⚠️ source-file MUST be normalised too. For a violation caused by an inline
 * script, the browser reports the DOCUMENT as the source file — so an
 * unnormalised `source-file` would carry the `/pay/<token>` path that
 * `document-uri` was carefully protected from. A first-party path goes through
 * the same route normalisation; only a genuine asset path (/_next/static/…)
 * survives intact, because it matches no page route and is not sensitive.
 */
function toReference(value: string): string {
  if (!value) return "";
  try {
    const u = new URL(value);
    if (u.protocol === "data:" || u.protocol === "blob:") return u.protocol.replace(":", "");
    // A first-party file is worth locating; a third-party one is not.
    const firstParty = /(^|\.)drop-q\.com$/.test(u.hostname) || u.hostname === "localhost";
    return firstParty ? normalizeDocumentPath(u.pathname) : u.origin;
  } catch {
    return normalizeDocumentPath(sanitizePathname(value));
  }
}

/**
 * Upsert on the dedup key: one row per distinct violation, with a count.
 *
 * This is what makes the endpoint's exposure acceptable. Under the current
 * Report-Only policy every page view reports the same handful of inline
 * scripts, so without this the table would grow with traffic instead of with
 * the number of real problems.
 */
async function store(row: Row): Promise<void> {
  const now = new Date();
  const expiresAt = cspExpiryFrom(now);
  try {
    await prisma.$executeRaw`
      INSERT INTO "CspReport" (
        "id", "documentPath", "effectiveDirective", "blockedUri", "sourceFile",
        "lineNumber", "columnNumber", "disposition", "count",
        "firstSeenAt", "lastSeenAt", "expiresAt"
      )
      VALUES (
        gen_random_uuid()::text, ${row.documentPath}, ${row.effectiveDirective},
        ${row.blockedUri}, ${row.sourceFile}, ${row.lineNumber}, ${row.columnNumber},
        ${row.disposition}, 1, ${now}, ${now}, ${expiresAt}
      )
      ON CONFLICT ("documentPath", "effectiveDirective", "blockedUri", "sourceFile", "lineNumber", "columnNumber")
      DO UPDATE SET
        "count" = "CspReport"."count" + 1,
        "lastSeenAt" = ${now},
        "expiresAt" = ${expiresAt}`;
  } catch (e) {
    console.error("[csp-report] store failed:", e instanceof Error ? e.message : e);
  }
}

/** Nothing to serve. A GET here is a scanner, not a browser. */
export async function GET() {
  return new Response(null, { status: 405 });
}
