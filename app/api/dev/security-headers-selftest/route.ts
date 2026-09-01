import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  BLOB_HOST,
  BROWSER_ORIGINS,
  CSP_HEADER_ENFORCED,
  CSP_HEADER_REPORT_ONLY,
  CSP_REPORT_PATH,
  FORBIDDEN_ORIGINS,
  PERMISSIONS_POLICY,
  STATIC_SECURITY_HEADERS,
  buildCsp,
} from "@/lib/security-headers";
import { RULES } from "@/lib/rate-limit";
import { ROUTE_PATTERNS, normalizeDocumentPath, sanitizePathname } from "@/lib/csp-reports";
import { readdirSync as readdir } from "node:fs";
import { fixtureRefusal, fixtureRefusalBody } from "@/lib/fixture-guard";

/**
 * Security headers, the Report-Only CSP, and the violation collector.
 *
 * Writes CspReport rows, so it is fixture-producing and refuses anywhere but
 * the harness database.
 *
 * The browser suite proves the headers arrive on a real response and that the
 * clickjacking defence actually works in a real browser. This proves the
 * things a browser cannot show: that the policy says exactly what we think,
 * that no forbidden origin has crept in, and that the collector cannot be made
 * to store something it should not.
 */

type Result = { name: string; pass: boolean; detail?: string };

/** Parse a CSP header value into directive → sources. */
function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources);
  }
  return out;
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const refusal = fixtureRefusal();
  if (refusal) return NextResponse.json(fixtureRefusalBody(refusal), { status: 503 });

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  const csp = buildCsp();
  const d = parseCsp(csp);
  const header = (key: string) =>
    STATIC_SECURITY_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

  /* ------------------------- 1. Static headers -------------------------- */
  {
    check("X-Content-Type-Options is exactly nosniff", header("X-Content-Type-Options") === "nosniff");
    check("X-Frame-Options is exactly DENY", header("X-Frame-Options") === "DENY");
    check("Referrer-Policy is strict-origin-when-cross-origin",
      header("Referrer-Policy") === "strict-origin-when-cross-origin");
    check("Cross-Origin-Opener-Policy is same-origin",
      header("Cross-Origin-Opener-Policy") === "same-origin");
    check("Cross-Origin-Resource-Policy is cross-origin, not same-origin",
      header("Cross-Origin-Resource-Policy") === "cross-origin");

    // The two deliberate absences. Both would be easy to add "for completeness"
    // and both would cause a real outage, so they are asserted absent by name.
    check("COEP is NOT sent — require-corp would break Blob images and Mapbox tiles",
      header("Cross-Origin-Embedder-Policy") === undefined);
    check("HSTS is NOT set by us — Vercel already sends it correctly",
      header("Strict-Transport-Security") === undefined);

    const cfg = readFileSync("next.config.ts", "utf8");
    check("poweredByHeader is disabled", /poweredByHeader:\s*false/.test(cfg));
    check("next.config sets no security header of its own",
      !/["']X-Frame-Options["']|["']Referrer-Policy["']/.test(cfg));
    check("the CSP is scoped to HTML documents by the Accept header",
      /key:\s*"accept"/.test(cfg) && /text\/html/.test(cfg));
    check("static headers apply to the whole surface",
      /source:\s*"\/:path\*"/.test(cfg));
  }

  /* ---------------------- 2. Permissions-Policy ------------------------- */
  {
    const pp = PERMISSIONS_POLICY;
    // Used by the product — disabling these would break a real feature.
    check("geolocation stays enabled for discover and the Mapbox control",
      pp.includes("geolocation=(self)"));
    check("clipboard-write stays enabled for the copy and share buttons",
      pp.includes("clipboard-write=(self)"));
    check("fullscreen stays enabled", pp.includes("fullscreen=(self)"));
    // Not used anywhere — verified by source search during the audit.
    for (const feature of ["camera", "microphone", "payment", "usb", "midi", "magnetometer",
      "gyroscope", "accelerometer", "display-capture", "serial", "bluetooth",
      "interest-cohort", "browsing-topics"]) {
      check(`${feature} is disabled`, pp.includes(`${feature}=()`));
    }
    check("nothing is granted to a wildcard", !pp.includes("*"));

    // The claim behind geolocation=(self): the code really does use it.
    const discover = readFileSync("components/discover-client.tsx", "utf8");
    check("discover really does call navigator.geolocation",
      /navigator\.geolocation\.getCurrentPosition/.test(discover));
    const map = readFileSync("components/dropmeet/map.tsx", "utf8");
    check("the map really does add a GeolocateControl", /GeolocateControl/.test(map));
  }

  /* ------------------------ 3. CSP shape -------------------------------- */
  {
    check("the policy is Report-Only in this stage",
      CSP_HEADER_REPORT_ONLY === "Content-Security-Policy-Report-Only");
    check("the enforced header name is defined but unused in this stage",
      CSP_HEADER_ENFORCED === "Content-Security-Policy" &&
      !readFileSync("next.config.ts", "utf8").includes("CSP_HEADER_ENFORCED"));

    for (const dir of ["default-src", "script-src", "style-src", "style-src-attr", "img-src",
      "font-src", "connect-src", "worker-src", "frame-src", "frame-ancestors",
      "form-action", "base-uri", "object-src", "media-src", "manifest-src"]) {
      check(`${dir} is present`, d.has(dir));
    }
    check("upgrade-insecure-requests is present", d.has("upgrade-insecure-requests"));
    check("no directive is declared twice",
      csp.split(";").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean).length === d.size);
    check("no directive is left empty",
      [...d.entries()].every(([k, v]) => v.length > 0 || k === "upgrade-insecure-requests"));

    check("default-src is 'self'", d.get("default-src")?.join(" ") === "'self'");
    check("frame-ancestors is 'none'", d.get("frame-ancestors")?.join(" ") === "'none'");
    check("frame-src is 'none' — the app embeds no iframe anywhere",
      d.get("frame-src")?.join(" ") === "'none'");
    check("object-src is 'none'", d.get("object-src")?.join(" ") === "'none'");
    check("base-uri is 'self'", d.get("base-uri")?.join(" ") === "'self'");
    check("font-src is 'self' — next/font self-hosts", d.get("font-src")?.join(" ") === "'self'");
    check("worker-src allows blob: for the Mapbox worker",
      d.get("worker-src")?.includes("blob:") === true);
    check("img-src allows data: for server-rendered QR codes",
      d.get("img-src")?.includes("data:") === true);
  }

  /* ---------------- 4. The unsafe things, and only those ---------------- */
  {
    check("script-src is exactly 'self' — no inline escape hatch",
      d.get("script-src")?.join(" ") === "'self'");
    check("'unsafe-inline' appears ONLY under style-src-attr",
      [...d.entries()].filter(([, v]) => v.includes("'unsafe-inline'")).map(([k]) => k).join() ===
        "style-src-attr");
    check("'unsafe-eval' appears nowhere", !csp.includes("'unsafe-eval'"));
    check("'strict-dynamic' is not used yet — it needs nonces", !csp.includes("'strict-dynamic'"));
    check("no bare wildcard in any directive",
      [...d.values()].every((sources) => !sources.includes("*")));
    check("no scheme-wide wildcard either",
      !/\shttps:(\s|;|$)/.test(csp) && !csp.includes("*."));
  }

  /* --------------------- 5. The origin allowlist ------------------------ */
  {
    check("the Blob host is pinned exactly, not wildcarded",
      BLOB_HOST === "https://rsvjjuuoioqd578j.public.blob.vercel-storage.com" &&
      !BLOB_HOST.includes("*"));
    check("img-src carries the exact Blob host", d.get("img-src")?.includes(BLOB_HOST) === true);
    check("img-src carries the Mapbox tile origin",
      d.get("img-src")?.includes(BROWSER_ORIGINS.mapboxApi) === true);
    check("connect-src carries both Mapbox origins",
      d.get("connect-src")?.includes(BROWSER_ORIGINS.mapboxApi) === true &&
      d.get("connect-src")?.includes(BROWSER_ORIGINS.mapboxEvents) === true);
    check("form-action carries all three Stripe redirect targets",
      ["stripeCheckout", "stripeBilling", "stripeConnect"].every(
        (k) => d.get("form-action")?.includes(BROWSER_ORIGINS[k as keyof typeof BROWSER_ORIGINS]) === true));
    check("form-action carries the Google sign-in origin",
      d.get("form-action")?.includes(BROWSER_ORIGINS.google) === true);
    check("form-action still allows 'self'", d.get("form-action")?.includes("'self'") === true);

    // The origins that must never appear, each one a mistake waiting to happen.
    for (const origin of FORBIDDEN_ORIGINS) {
      check(`${origin} is absent`, !csp.includes(origin));
    }
    check("no Stripe origin leaked into script-src or connect-src",
      !d.get("script-src")?.some((s) => s.includes("stripe")) &&
      !d.get("connect-src")?.some((s) => s.includes("stripe")));

    // The inventory is the checked-in claim; the policy must not exceed it.
    const allowed = new Set<string>([...Object.values(BROWSER_ORIGINS)]);
    const used = new Set(csp.match(/https:\/\/[^\s;]+/g) ?? []);
    const unknown = [...used].filter((u) => !allowed.has(u));
    check("every external origin in the policy is in the inventory", unknown.length === 0,
      unknown.join(", "));
  }

  /* --------------------- 6. Reporting configuration --------------------- */
  {
    check("the policy reports to a first-party path",
      d.get("report-uri")?.join(" ") === CSP_REPORT_PATH && CSP_REPORT_PATH.startsWith("/"));
    check("no third-party collector", !/report-uri\s+https?:/.test(csp));
    check("report-to is not used alongside report-uri — it would double-report in Chrome",
      !d.has("report-to"));

    // CSP ingestion must not have inherited an auth-shaped threshold.
    const csp5 = (RULES.cspReport as readonly { max: number; windowMs: number }[])
      .find((l) => l.windowMs === 5 * 60_000)?.max;
    const login = (RULES.login as readonly { dimension: string; max: number }[])
      .find((l) => l.dimension === "ip")?.max;
    check("the CSP limit is its own number, not the login limit", csp5 !== login);
    check("the CSP limit is generous enough for real reporting", (csp5 ?? 0) >= 200,
      `${csp5} per 5 minutes`);
    check("there is still a daily ceiling",
      (RULES.cspReport as readonly { windowMs: number }[]).some((l) => l.windowMs === 86_400_000));
  }

  /* -------------------- 7. The collector's privacy ---------------------- */
  {
    // Comments stripped: the collector documents at length which fields it
    // REFUSES to store, so a naive scan reads its own explanation as evidence
    // of the thing it is promising not to do.
    const src = readFileSync("app/api/csp-report/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    check("the collector never persists an IP",
      !/clientIp\([^)]*\)\s*[,)]?\s*(?!.*consume)/.test(src.replace(/consume\([^)]*\)/g, "")) ||
      !/prisma[\s\S]*clientIp/.test(src));
    check("the IP is used for the limiter only, never in a query",
      (src.match(/clientIp\(/g) ?? []).length === 1 && /consume\("cspReport", \{ ip: clientIp/.test(src));
    check("no cookie is read", !/cookies\(\)|req\.cookies/.test(src));
    check("headers are not stored wholesale",
      !/headers\.forEach|Object\.fromEntries\(.*headers/.test(src));
    check("script samples are never read", !/script-sample|scriptSample/.test(src));
    check("the original policy is never read", !/original-policy|originalPolicy/.test(src));
    check("the user agent is never read", !/user-agent|userAgent/.test(src));
    check("fields are allowlisted rather than spread",
      !/\.\.\.report|\.\.\.parsed|\.\.\.body/.test(src));
    check("a body size ceiling exists", /MAX_BYTES/.test(src) && /16 \* 1024/.test(src));
    check("it always answers 204", (src.match(/return NOOP/g) ?? []).length >= 5);
    check("the store call cannot throw into the handler", /catch[\s\S]{0,120}store failed/.test(src));
    check("no other module imports the collector",
      !/from "@\/app\/api\/csp-report/.test(readFileSync("lib/security-headers.ts", "utf8")));
  }

  /* ------------------- 8. The collector, exercised ---------------------- */
  {
    const { POST } = await import("@/app/api/csp-report/route");
    const post = (body: unknown, init?: RequestInit) =>
      POST(new Request("http://localhost/api/csp-report", {
        method: "POST",
        headers: { "content-type": "application/csp-report", ...(init?.headers ?? {}) },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }) as never);

    const uniq = `probe-${Date.now().toString(36)}`;

    // ---- a valid report is accepted and stored ----
    const valid = {
      "csp-report": {
        "document-uri": `https://www.drop-q.com/${uniq}?token=SECRET&utm_source=ig#frag`,
        "referrer": "https://www.google.com/search?q=private",
        "violated-directive": "script-src 'self'",
        "effective-directive": "script-src",
        "original-policy": "default-src 'self'; script-src 'self'",
        "blocked-uri": "inline",
        "source-file": `https://www.drop-q.com/${uniq}?token=SECRET`,
        "line-number": 42,
        "column-number": 7,
        "status-code": 200,
        "script-sample": "const cardNumber = 4242424242424242",
        "disposition": "report",
      },
    };
    check("a valid report answers 204", (await post(valid)).status === 204);

    const stored = await prisma.cspReport.findFirst({ where: { documentPath: `/${uniq}` } });
    check("the report was stored", Boolean(stored));
    check("the query string was stripped from the document path",
      stored?.documentPath === `/${uniq}`, stored?.documentPath);
    check("the fragment was stripped", !stored?.documentPath.includes("#"));
    check("the token never reached the database",
      !JSON.stringify(stored ?? {}).includes("SECRET"));
    check("the script sample was discarded",
      !JSON.stringify(stored ?? {}).includes("4242424242424242"));
    check("the referrer was discarded", !JSON.stringify(stored ?? {}).includes("google.com"));
    check("the original policy was discarded",
      !JSON.stringify(stored ?? {}).includes("default-src"));
    check("the directive was reduced to its name", stored?.effectiveDirective === "script-src");
    check("the blocked keyword was kept as-is", stored?.blockedUri === "inline");
    check("the source file kept its path but lost its query",
      stored?.sourceFile === `/${uniq}`, stored?.sourceFile);
    check("line and column survived", stored?.lineNumber === 42 && stored?.columnNumber === 7);
    check("a retention date was set",
      Boolean(stored?.expiresAt) && stored!.expiresAt.getTime() > Date.now());

    // ---- duplicates collapse into one row ----
    for (let i = 0; i < 5; i++) await post(valid);
    const after = await prisma.cspReport.findMany({ where: { documentPath: `/${uniq}` } });
    check("a flood of identical reports stays one row", after.length === 1, `${after.length} rows`);
    check("the count rose instead", after[0]?.count === 6, `count ${after[0]?.count}`);
    check("lastSeenAt moved forward",
      after[0]!.lastSeenAt.getTime() >= after[0]!.firstSeenAt.getTime());

    // ---- a cross-origin blocked URI is reduced to its origin ----
    const external = `${uniq}-ext`;
    await post({ "csp-report": {
      "document-uri": `https://www.drop-q.com/${external}`,
      "effective-directive": "img-src",
      "blocked-uri": "https://evil.example.com/track.gif?visitor=abc123&email=a@b.c",
    }});
    const ext = await prisma.cspReport.findFirst({ where: { documentPath: `/${external}` } });
    check("a third-party URL is reduced to its origin",
      ext?.blockedUri === "https://evil.example.com", ext?.blockedUri);
    check("its query string never reached us",
      !JSON.stringify(ext ?? {}).includes("abc123") && !JSON.stringify(ext ?? {}).includes("a@b.c"));

    // ---- malformed and hostile payloads ----
    const before = await prisma.cspReport.count();
    for (const [label, body] of [
      ["not JSON at all", "<<<not json>>>"],
      ["an empty body", ""],
      ["JSON null", "null"],
      ["a bare number", "12345"],
      ["an empty object", "{}"],
      ["a report with no directive", JSON.stringify({ "csp-report": { "blocked-uri": "inline" } })],
      ["a deeply nested object", JSON.stringify({ "csp-report": { a: { b: { c: { d: "x" } } } } })],
      ["an array of junk", JSON.stringify([1, 2, 3])],
      ["a directive of the wrong type", JSON.stringify({ "csp-report": { "effective-directive": { x: 1 } } })],
      ["prototype pollution", JSON.stringify({ "csp-report": { __proto__: { polluted: true }, "effective-directive": "" } })],
    ] as const) {
      const res = await post(body);
      check(`${label} cannot crash the collector`, res.status === 204, `status ${res.status}`);
    }
    check("no malformed payload created a row",
      (await prisma.cspReport.count()) === before, "row count changed");
    check("prototype pollution did not take",
      ({} as Record<string, unknown>).polluted === undefined);

    // ---- oversized payloads ----
    const huge = JSON.stringify({ "csp-report": {
      "document-uri": "https://www.drop-q.com/big",
      "effective-directive": "script-src",
      "blocked-uri": "x".repeat(40_000),
    }});
    check("an oversized body is refused safely",
      (await post(huge)).status === 204 &&
      (await prisma.cspReport.count({ where: { documentPath: "/big" } })) === 0);
    check("a declared oversize content-length short-circuits",
      (await post(valid, { headers: { "content-length": String(99_999) } })).status === 204);

    // ---- long-but-legal values are truncated, not rejected ----
    const longPath = "/" + "a".repeat(900);
    await post({ "csp-report": {
      "document-uri": `https://www.drop-q.com${longPath}`,
      "effective-directive": "style-src",
      "blocked-uri": "inline",
    }});
    const truncated = await prisma.cspReport.findFirst({
      where: { effectiveDirective: "style-src" }, orderBy: { firstSeenAt: "desc" },
    });
    check("an over-long path is truncated rather than stored whole",
      (truncated?.documentPath.length ?? 0) <= 512);

    // ---- GET is not a thing ----
    const { GET: collectorGet } = await import("@/app/api/csp-report/route");
    check("GET on the collector is 405", (await collectorGet()).status === 405);

    // ---- cleanup ----
    await prisma.cspReport.deleteMany({
      where: { OR: [
        { documentPath: { startsWith: `/${uniq}` } },
        { documentPath: longPath.slice(0, 512) },
      ] },
    });
  }

  /* ------------- 8b. Document paths are reduced to route patterns ------- */
  {
    // Every dynamic route family that can render an HTML document, and so can
    // produce a CSP report. One case per family, using realistic values.
    const cases: [string, string][] = [
      // storefronts and drops
      ["/s/britts-bunnies", "/s/[slug]"],
      ["/s/casa-makulay/cmth9x2k40001abcd", "/s/[slug]/[dropId]"],
      // orders
      ["/order/cmth9x2k40001abcdefghijkl", "/order/[id]"],
      ["/my/orders/cmth9x2k40001abcdefghijkl", "/my/orders/[id]"],
      // vendor dashboard
      ["/dashboard/drops/cmth9x2k40001abcd", "/dashboard/drops/[id]"],
      ["/dashboard/drops/cmth9x2k40001abcd/edit", "/dashboard/drops/[id]/edit"],
      ["/dashboard/drops/cmth9x2k40001abcd/sale", "/dashboard/drops/[id]/sale"],
      // messaging
      ["/messages/cmth9x2k40001abcd", "/messages/[conversationId]"],
      ["/dashboard/messages/cmth9x2k40001abcd", "/dashboard/messages/[conversationId]"],
      // share / QR / pay — the walk-up payment token is a PATH segment
      ["/pay/2f8a1c9e4b7d6a3f5e0c8b1d9a4f7e2c", "/pay/[token]"],
      // admin
      ["/admin/cmth9x2k40001abcd", "/admin/[id]"],
      ["/admin/sales-reps/cmth9x2k40001abcd", "/admin/sales-reps/[id]"],
      ["/admin/dropmeet/locations/cmth9x2k40001abcd", "/admin/dropmeet/locations/[id]"],
      // dropmeet
      ["/dropmeet/events/farmers-market-october", "/dropmeet/events/[slug]"],
      ["/dropmeet/locations/north-park", "/dropmeet/locations/[slug]"],
      ["/dropmeet/markets/little-italy", "/dropmeet/markets/[slug]"],
      // content
      ["/help/connect-stripe", "/help/[slug]"],
      ["/sell/food", "/sell/[category]"],
    ];
    for (const [input, expected] of cases) {
      check(`${input} → ${expected}`, normalizeDocumentPath(input) === expected,
        normalizeDocumentPath(input));
    }

    // Static routes that SHARE A SHAPE with a dynamic one must survive intact.
    // This is the failure a regex-based normaliser would produce.
    for (const path of [
      "/", "/login", "/signup", "/pricing", "/privacy", "/terms", "/discover",
      "/dashboard/drops/new",      // vs /dashboard/drops/[id]
      "/dashboard/drops",          // vs nothing
      "/messages/login",           // vs /messages/[conversationId]
      "/admin/activation",         // vs /admin/[id]
      "/admin/commissions",        // vs /admin/[id]
      "/admin/dropmeet",           // vs /admin/[id]
      "/admin/sales-reps",         // vs /admin/[id]
      "/admin/dropmeet/new",       // vs /admin/dropmeet/locations/[id] (different depth)
      "/my/orders",                // vs /my/orders/[id]
      "/dropmeet/add",
      "/rep/login", "/reset", "/forgot", "/sms", "/vendor/signup",
    ]) {
      check(`static route survives: ${path}`, normalizeDocumentPath(path) === path,
        normalizeDocumentPath(path));
    }

    // THE ONE THAT MATTERS. A live walk-up payment token is a path segment, so
    // stripping the query would not have protected it.
    const token = "2f8a1c9e4b7d6a3f5e0c8b1d9a4f7e2c";
    check("a live pay token never survives normalisation",
      !normalizeDocumentPath(`/pay/${token}`).includes(token));
    check("nor does it survive with a query attached",
      !normalizeDocumentPath(`https://www.drop-q.com/pay/${token}?amount=42#top`).includes(token));

    // Query strings and fragments, on every shape.
    check("a query string is removed",
      normalizeDocumentPath("/s/cedar?utm_source=ig&token=SECRET") === "/s/[slug]");
    check("a fragment is removed",
      normalizeDocumentPath("/help/connect-stripe#step-3") === "/help/[slug]");
    check("an absolute URL is reduced to its route",
      normalizeDocumentPath("https://www.drop-q.com/order/abc123?x=1") === "/order/[id]");
    check("a reset token in the query never survives",
      !normalizeDocumentPath("/reset?token=SUPERSECRET").includes("SUPERSECRET"));
    check("a magic-link token in the query never survives",
      !normalizeDocumentPath("/messages/verify?token=SUPERSECRET").includes("SUPERSECRET"));

    // Unknown paths fall back safely rather than throwing or leaking.
    check("an unknown path falls back to a sanitised pathname",
      normalizeDocumentPath("/not-a-real-route/x?y=1#z") === "/not-a-real-route/x");
    check("an absurdly deep path is not matched against anything",
      normalizeDocumentPath("/" + Array(30).fill("a").join("/")).startsWith("/a/a"));
    check("an over-long path is capped",
      normalizeDocumentPath("/" + "a".repeat(900)).length <= 512);
    check("control characters are stripped",
      !sanitizePathname("/s/ce\u0000dar\u001f").includes("\u0000"));
    check("a relative value still yields a rooted path",
      sanitizePathname("s/cedar").startsWith("/"));
    check("an empty value is handled", sanitizePathname("") === "");

    // THE GUARD ON THE TABLE ITSELF: it must match the app directory exactly,
    // so a new dynamic route cannot be added without updating the normaliser.
    const onDisk: string[] = [];
    const walk = (dir: string, route: string) => {
      for (const entry of readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "api") continue;
        walk(`${dir}/${entry.name}`, `${route}/${entry.name}`);
      }
      if (readdir(dir).includes("page.tsx")) onDisk.push(route === "" ? "/" : route);
    };
    walk("app", "");
    const missing = onDisk.filter((r) => !(ROUTE_PATTERNS as readonly string[]).includes(r));
    const stale = (ROUTE_PATTERNS as readonly string[]).filter((r) => !onDisk.includes(r));
    check("every page route on disk is in the pattern table", missing.length === 0,
      missing.join(", "));
    check("the pattern table contains no route that no longer exists", stale.length === 0,
      stale.join(", "));

    // The collector must normalise source-file too: for an inline-script
    // violation the browser reports the DOCUMENT as the source file.
    const collector = readFileSync("app/api/csp-report/route.ts", "utf8");
    check("source-file is normalised, not just the document path",
      /firstParty \? normalizeDocumentPath/.test(collector));
  }

  /* ------------------- 8c. The database safety guard -------------------- */
  {
    const guard = readFileSync("scripts/db-guard.mjs", "utf8");
    check("the guard requires CONFIRM_PRODUCTION_MIGRATION=1",
      /CONFIRM_PRODUCTION_MIGRATION === "1"/.test(guard));
    check("the guard fails closed when no URL resolves",
      /urls\.length === 0[\s\S]{0,120}refuse\(/.test(guard));
    check("the guard fails closed when a URL cannot be parsed",
      /h === null[\s\S]{0,120}refuse\(/.test(guard));
    check("the guard reads .env, because that is what Prisma prefers",
      /readFileSync\(envFile/.test(guard) && /DATABASE_URL/.test(guard));
    check("the guard checks BOTH the environment and .env",
      /process\.env\.DATABASE_URL/.test(guard) && /envFile/.test(guard));
    check("the guard covers every mutating Prisma subcommand",
      ["migrate deploy", "migrate dev", "migrate reset", "migrate resolve",
       "db push", "db seed", "db execute"].every((c) => guard.includes(`"${c}"`)));
    check("the guard uses the repository-local Prisma binary",
      /node_modules", "\.bin", "prisma"/.test(guard));
    check("the guard never shells out to npx", !/npx/.test(guard.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));

    // It must never print a credential. The only thing it is allowed to show
    // is a hostname.
    const code = guard.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    check("no log statement can contain a URL",
      !/console\.(log|error)\([^)]*\b(url|urls)\b/.test(code));
    check("only hostnames are ever interpolated into output",
      !/\$\{urls?\[/.test(code));
    check("the guard points at the safe validation path",
      guard.includes("verify-migrations.mjs"));
    check("the incident is documented", /MIGRATION-SAFETY/.test(guard));

    const runbook = readFileSync("docs/MIGRATION-SAFETY.md", "utf8");
    check("the runbook documents the guard",
      /CONFIRM_PRODUCTION_MIGRATION/.test(runbook) && /db-guard/.test(runbook));
    check("the runbook states the never-use rule",
      /[Nn]ever/.test(runbook) && /migrate deploy/.test(runbook));

    // The validator must not be able to reach production the way deploy did.
    // Comments stripped — the validator explains in prose why it does NOT use
    // `migrate deploy`, and a naive scan reads that explanation as the offence.
    const verifier = readFileSync("scripts/verify-migrations.mjs", "utf8");
    const verifierCode = verifier
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    check("the migration validator never runs a mutating command",
      !/migrate deploy|migrate dev|db push/.test(verifierCode));
    check("the migration validator passes a shadow URL explicitly",
      /--shadow-database-url/.test(verifier));
  }

  /* ------------------------- 9. Retention ------------------------------- */
  {
    const { purgeExpiredCspReports } = await import("@/lib/csp-reports");
    const expired = await prisma.cspReport.create({
      data: {
        documentPath: `/expired-${Date.now()}`, effectiveDirective: "script-src",
        blockedUri: "inline", expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const purged = await purgeExpiredCspReports();
    check("expired reports are deleted", purged >= 1, `${purged} rows`);
    check("the expired row is gone",
      (await prisma.cspReport.count({ where: { id: expired.id } })) === 0);

    const cron = readFileSync("app/api/cron/reminders/route.ts", "utf8");
    check("cleanup runs from the EXISTING cron, not a new one",
      /purgeExpiredCspReports\(\)/.test(cron));
    const vercelJson = readFileSync("vercel.json", "utf8");
    check("no second cron schedule was added",
      (JSON.parse(vercelJson).crons ?? []).length === 1);

    check("retention is 90 days",
      /CSP_RETENTION_DAYS = 90/.test(readFileSync("lib/csp-reports.ts", "utf8")));
    check("the limiter still touches only its own table",
      (readFileSync("lib/rate-limit.ts", "utf8").match(/prisma\.\w+\./g) ?? [])
        .every((m) => m === "prisma.rateLimit."));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "security-headers",
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
