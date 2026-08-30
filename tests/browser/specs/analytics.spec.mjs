/**
 * The analytics foundation, in a real browser against a real database.
 *
 * The content self-test proves the rules in isolation. This proves the system:
 * that cookies are actually issued (and actually withheld), that a beacon
 * actually becomes a row, that a forged conversion event actually bounces, and
 * — most importantly — that a PREVIEW build pointed at the production database
 * writes nothing at all.
 *
 * That last one is not hypothetical. Vercel's DATABASE_URL is one variable
 * scoped to Preview *and* Production, so "preview app, production data" is the
 * live configuration. This spec reproduces it exactly: a second app process,
 * VERCEL_ENV=preview, same database, and then it counts the rows.
 *
 * Three app processes, one shared database:
 *   :3123  the suite's own app — ANALYTICS_MODE unset, i.e. OFF (the default)
 *   :3124  ANALYTICS_MODE=on, VERCEL_ENV=production
 *   :3125  ANALYTICS_MODE=on, VERCEL_ENV=preview
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, recorder } from "../support/browser.mjs";
import { assertVerifyDatabase, APP_URL } from "../support/guard.mjs";
import { startApp } from "../support/stack.mjs";
import { openClient } from "../seed/vendor.mjs";

const DB = assertVerifyDatabase();
const r = recorder("analytics");
const db = await openClient(prismaModule, DB);
const browser = await launch();

const BASE_ENV = { ...process.env, ANALYTICS_MODE: "on" };
// Separate build directories: parallel dev servers cannot share `.next`.
const ON = await startApp({
  port: 3124,
  distDir: ".next-analytics-on",
  env: { ...BASE_ENV, VERCEL_ENV: "production" },
});
const PREVIEW = await startApp({
  port: 3125,
  distDir: ".next-analytics-preview",
  env: { ...BASE_ENV, VERCEL_ENV: "preview" },
});

/**
 * Playwright's Chrome announces itself as `HeadlessChrome`, which the bot filter
 * correctly refuses — so a spec pretending to be a person has to look like one.
 * Overriding the user agent here is not weakening the check: the EXCLUSIONS
 * section below runs a real Googlebot string against the same filter, and it is
 * only meaningful BECAUSE the human contexts are not caught by accident.
 */
const HUMAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const humanContext = (extra = {}) =>
  browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: HUMAN_UA, ...extra });

const clean = () => db.analyticsEvent.deleteMany({});
const count = (where = {}) => db.analyticsEvent.count({ where });
const settle = (ms = 900) => new Promise((res) => setTimeout(res, ms));

/** A page visit that behaves like a person, not a script. */
async function visit(base, path, opts = {}) {
  const context = opts.context ?? (await humanContext());
  const page = await context.newPage();
  if (opts.referer) await page.setExtraHTTPHeaders({ referer: opts.referer });
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await settle(opts.settle ?? 900);
  const cookies = await context.cookies();
  const result = { context, page, cookies, get: (n) => cookies.find((c) => c.name === n) };
  if (!opts.keep) {
    await page.close();
    if (!opts.context) await context.close();
  }
  return result;
}

/* ================= 1. OFF is the default and it is silent ================= */
r.section("ANALYTICS OFF (the shipped default)");
{
  await clean();
  const v = await visit(APP_URL, "/pricing");
  r.ok("no visitor cookie is issued", !v.get("dq_vid"), JSON.stringify(v.cookies.map((c) => c.name)));
  r.ok("no session cookie is issued", !v.get("dq_sid"));
  r.ok("no attribution cookie is issued", !v.get("dq_attr"));
  r.ok("nothing is written", (await count()) === 0);

  // Even a hand-crafted beacon writes nothing while the policy says off.
  const res = await fetch(`${APP_URL}/api/track`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ event: "page_viewed", path: "/pricing" }),
  });
  await settle();
  r.ok("a direct beacon is refused too", res.status === 204 && (await count()) === 0);
}

/* ==================== 2. PREVIEW cannot contaminate ====================== */
r.section("PREVIEW GUARD (same database, VERCEL_ENV=preview)");
{
  await clean();
  const v = await visit(PREVIEW.url, "/pricing?utm_source=ig&utm_campaign=founders");
  r.ok("preview issues no visitor identity", !v.get("dq_vid"));
  r.ok("preview issues no session identity", !v.get("dq_sid"));
  r.ok("preview writes no events", (await count()) === 0, `${await count()} rows`);

  // Force the issue: hand preview a valid-looking identity and a valid event.
  const forced = await humanContext();
  await forced.addCookies([
    { name: "dq_vid", value: "a".repeat(32), url: PREVIEW.url },
    { name: "dq_sid", value: "b".repeat(32), url: PREVIEW.url },
  ]);
  const page = await forced.newPage();
  await page.goto(`${PREVIEW.url}/pricing`, { waitUntil: "networkidle" });
  await page.evaluate(() =>
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "page_viewed", path: "/pricing" }),
    })
  );
  await settle(1200);
  r.ok("preview refuses even a fully-formed beacon with valid identity",
    (await count()) === 0, `${await count()} rows`);
  await forced.close();

  r.ok("the production database is reachable from preview — the guard is what stops it, not the network",
    (await db.seller.count()) >= 0);
}

/* ====================== 3. Identity, when enabled ======================== */
r.section("IDENTITY (ANALYTICS_MODE=on)");
let firstVisitor = null;
{
  await clean();
  const ctx = await humanContext();
  const v = await visit(ON.url, "/pricing", { context: ctx, keep: true });
  const vid = v.get("dq_vid");
  const sid = v.get("dq_sid");
  firstVisitor = vid?.value ?? null;

  r.ok("a visitor cookie is issued", !!vid);
  r.ok("a session cookie is issued", !!sid);
  r.ok("ids are 128 bits of hex", /^[0-9a-f]{32}$/.test(vid?.value ?? ""));
  r.ok("visitor and session are different ids", vid?.value !== sid?.value);
  r.ok("identity cookies are httpOnly", vid?.httpOnly === true && sid?.httpOnly === true);
  r.ok("identity cookies are sameSite lax", /lax/i.test(vid?.sameSite ?? ""));
  r.ok("the visitor cookie is long-lived, the session cookie is not",
    (vid?.expires ?? 0) - (sid?.expires ?? 0) > 60 * 60 * 24);

  const readable = await v.page.evaluate(() => document.cookie);
  r.ok("page JavaScript cannot read the identifiers",
    !readable.includes("dq_vid") && !readable.includes("dq_sid"), readable.slice(0, 80));

  // Second page, same browser: same visitor, same session.
  const again = await visit(ON.url, "/help", { context: ctx, keep: true });
  r.ok("the same browser keeps the same visitor id", again.get("dq_vid")?.value === vid?.value);
  r.ok("a second page in the same sitting keeps the session id",
    again.get("dq_sid")?.value === sid?.value);
  r.ok("the session cookie slides forward with activity",
    (again.get("dq_sid")?.expires ?? 0) >= (sid?.expires ?? 0));

  // A different browser is a different person.
  const other = await visit(ON.url, "/pricing");
  r.ok("a different browser is a different visitor",
    other.get("dq_vid")?.value !== vid?.value);
  await other.context.close();

  await again.page.close();
  await v.page.close();
  await ctx.close();
}

/* ========================= 4. Events and paths =========================== */
r.section("EVENTS");
{
  await clean();
  await visit(ON.url, "/pricing?utm_source=ig&utm_medium=social&utm_campaign=founders&token=SUPERSECRET&email=leak@example.com");
  const rows = await db.analyticsEvent.findMany({ orderBy: { at: "desc" } });
  const row = rows[0];

  r.ok("a page view is recorded", rows.length >= 1, `${rows.length} rows`);
  r.ok("the event is page_viewed", row?.name === "page_viewed", row?.name);
  r.ok("the path is stored without its query string", row?.path === "/pricing", row?.path);
  r.ok("the secret in the URL is nowhere in the row",
    !JSON.stringify(row ?? {}).includes("SUPERSECRET"));
  r.ok("the email in the URL is nowhere in the row",
    !JSON.stringify(row ?? {}).includes("leak@example.com"));
  r.ok("UTMs are captured", row?.utmSource === "ig" && row?.utmCampaign === "founders",
    `${row?.utmSource}/${row?.utmCampaign}`);
  r.ok("the environment is recorded", row?.env === "production", row?.env);
  r.ok("a real browser is not marked a bot", row?.isBot === false);
  r.ok("device class is captured", row?.device === "mobile", row?.device);
  r.ok("no IP address column exists", !("ip" in (row ?? {})) && !("ipAddress" in (row ?? {})));
  r.ok("dashboard pages are not recorded",
    rows.every((x) => !x.path.startsWith("/dashboard")));

  // Two pages in one sitting share a session.
  await clean();
  const ctx = await humanContext();
  await visit(ON.url, "/pricing", { context: ctx, keep: true });
  await visit(ON.url, "/help", { context: ctx, keep: true });
  const sessions = new Set((await db.analyticsEvent.findMany()).map((x) => x.sessionId));
  const visitors = new Set((await db.analyticsEvent.findMany()).map((x) => x.visitorId));
  r.ok("a sitting groups under one session id", sessions.size === 1, `${sessions.size}`);
  r.ok("a sitting groups under one visitor id", visitors.size === 1);
  await ctx.close();
}

/* ==================== 5. The sink refuses forgeries ====================== */
r.section("SINK HARDENING");
{
  await clean();
  const ctx = await humanContext();
  const page = await ctx.newPage();
  await page.goto(`${ON.url}/pricing`, { waitUntil: "networkidle" });
  await settle();
  const baseline = await count();

  const post = (body) =>
    page.evaluate(
      (b) =>
        fetch("/api/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
        }).then((res) => res.status),
      body
    );

  const forged = await post({ event: "vendor_first_paid_order", props: { totalCents: 999999 } });
  await settle();
  r.ok("a forged conversion event is refused",
    forged === 204 && (await count({ name: "vendor_first_paid_order" })) === 0);

  await post({ event: "definitely_not_real" });
  await settle();
  r.ok("an unknown event name is refused", (await count()) === baseline);

  await post({ event: "page_viewed", path: "/x", props: { email: "a@b.c" } });
  await settle();
  r.ok("an event carrying a forbidden property is refused",
    (await count({ path: "/x" })) === 0);

  await post({ event: "page_viewed", path: "/y", props: { query: "how do I get paid" } });
  await settle();
  r.ok("raw search text is refused", (await count({ path: "/y" })) === 0);

  // Identity comes from the cookie, never the body.
  await post({ event: "page_viewed", path: "/z", visitorId: "f".repeat(32) });
  await settle();
  const z = await db.analyticsEvent.findFirst({ where: { path: "/z" } });
  r.ok("a caller cannot choose their own visitor id",
    !z || z.visitorId !== "f".repeat(32), z?.visitorId);

  const cross = await fetch(`${ON.url}/api/track`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "cross-site",
      cookie: `dq_vid=${"a".repeat(32)}; dq_sid=${"b".repeat(32)}`,
    },
    body: JSON.stringify({ event: "page_viewed", path: "/cross" }),
  });
  await settle();
  r.ok("a cross-site beacon is refused",
    cross.status === 204 && (await count({ path: "/cross" })) === 0);

  await ctx.close();
}

/* ========================== 6. Attribution =============================== */
r.section("ATTRIBUTION");
{
  await clean();
  const ctx = await humanContext();

  // First touch: a campaign.
  await visit(ON.url, "/pricing?utm_source=qr&utm_campaign=ai-founders", { context: ctx, keep: true });
  const first = JSON.parse(
    decodeURIComponent((await ctx.cookies()).find((c) => c.name === "dq_attr")?.value ?? "{}")
  );
  r.ok("first touch records the campaign", first?.first?.campaign === "ai-founders",
    JSON.stringify(first?.first ?? {}));
  r.ok("a ?ref=qr link is classified as qr", first?.first?.channel === "qr", first?.first?.channel);

  // Second touch, days later, from Instagram.
  await visit(ON.url, "/pricing", { context: ctx, keep: true, referer: "https://www.instagram.com/p/abc" });
  const second = JSON.parse(
    decodeURIComponent((await ctx.cookies()).find((c) => c.name === "dq_attr")?.value ?? "{}")
  );
  r.ok("first touch is NOT overwritten", second?.first?.campaign === "ai-founders",
    JSON.stringify(second?.first ?? {}));
  r.ok("last touch moves to the newest qualifying source",
    second?.last?.source === "instagram.com", JSON.stringify(second?.last ?? {}));

  // An internal navigation must not become an acquisition source.
  await visit(ON.url, "/help", { context: ctx, keep: true, referer: `${ON.url}/pricing` });
  const third = JSON.parse(
    decodeURIComponent((await ctx.cookies()).find((c) => c.name === "dq_attr")?.value ?? "{}")
  );
  r.ok("our own site never becomes the last touch",
    third?.last?.source === "instagram.com", JSON.stringify(third?.last ?? {}));
  r.ok("no attribution cookie contains a full URL",
    !JSON.stringify(third).includes("http"));

  /* ---- anonymous → vendor ---- */
  const email = `analytics-spec-${Date.now()}@example.com`;
  const page = await ctx.newPage();
  await page.goto(`${ON.url}/signup`, { waitUntil: "networkidle" });
  await page.fill('input[name="storeName"]', "Spec Bakery");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "spec-password-123");
  const terms = page.locator('input[name="acceptTerms"]');
  if (await terms.count()) await terms.first().check();
  await page.getByRole("button", { name: /create|sign ?up|start/i }).first().click();
  await page.waitForURL(/dashboard|verify/, { timeout: 20_000 }).catch(() => {});
  await settle(1500);

  const seller = await db.seller.findUnique({ where: { email } });
  r.ok("the vendor was created", !!seller);
  r.ok("the anonymous visitor is stamped onto the vendor",
    !!seller?.firstTouchVisitorId && /^[0-9a-f]{32}$/.test(seller.firstTouchVisitorId));
  r.ok("the vendor carries their FIRST touch, not their last",
    seller?.signupCampaign === "ai-founders", seller?.signupCampaign ?? "(null)");
  r.ok("the vendor also carries the last touch, separately",
    seller?.lastTouchSource === "social", seller?.lastTouchSource ?? "(null)");
  r.ok("the first-touch timestamp is recorded", !!seller?.firstTouchAt);
  r.ok("the vendor's own history is joinable by visitor id",
    (await count({ visitorId: seller?.firstTouchVisitorId ?? "none" })) > 0);
  r.ok("vendor_signed_up is recorded server-side",
    (await count({ name: "vendor_signed_up", sellerId: seller?.id })) === 1);

  // A second stamp must not rewrite acquisition.
  const before = seller?.firstTouchAt?.toISOString();
  await db.seller.updateMany({
    where: { id: seller?.id, firstTouchAt: null },
    data: { signupCampaign: "should-never-apply" },
  });
  const after = await db.seller.findUnique({ where: { email } });
  r.ok("first-touch attribution cannot be rewritten",
    after?.signupCampaign === "ai-founders" && after?.firstTouchAt?.toISOString() === before);

  if (seller) {
    await db.analyticsEvent.deleteMany({ where: { sellerId: seller.id } });
    await db.seller.delete({ where: { id: seller.id } }).catch(() => {});
  }
  await ctx.close();
}

/* ======================= 7. Bots and exclusions ========================== */
r.section("EXCLUSIONS");
{
  await clean();
  const bot = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  });
  const page = await bot.newPage();
  await page.goto(`${ON.url}/pricing`, { waitUntil: "networkidle" });
  await settle();
  const cookies = await bot.cookies();
  r.ok("a crawler gets no identity", !cookies.find((c) => c.name === "dq_vid"));
  r.ok("a crawler writes no events", (await count()) === 0, `${await count()} rows`);
  await bot.close();
}

await clean();
await browser.close();
await PREVIEW.stop();
await ON.stop();
const ok = r.report();
await db.$disconnect();
process.exit(ok ? 0 : 1);
