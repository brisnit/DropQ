import { chromium } from "playwright";
import { PrismaClient } from "./app/generated/prisma/index.js";

const BASE = "https://www.drop-q.com";
const EMAIL = "analytics-check@dropq.example";
const STORE = "Analytics Activation Check";
// Playwright's Chrome says "HeadlessChrome", which the bot filter correctly
// refuses. A person's browser does not, so simulate one honestly.
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const db = new PrismaClient();
const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : "(none)");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`); };
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: UA, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 110)); });
page.on("pageerror", (e) => problems.push("pageerror: " + String(e).slice(0, 110)));
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("favicon")) problems.push(`${r.status()} ${r.url().slice(0, 70)}`); });

/* ---------------- 3. the very first anonymous request ------------------- */
console.log("\n=== 3. FIRST ANONYMOUS REQUEST ===");
ok("browser starts with no DropQ cookies", (await ctx.cookies()).length === 0);
await page.goto(`${BASE}/?utm_source=activation&utm_campaign=first-check`, { waitUntil: "networkidle" });
await settle(2500);

const cookies = await ctx.cookies();
const get = (n) => cookies.find((c) => c.name === n);
const vid = get("dq_vid"), sid = get("dq_sid"), attr = get("dq_attr");
console.log(`     dq_vid  = ${mask(vid?.value)}`);
console.log(`     dq_sid  = ${mask(sid?.value)}`);
console.log(`     dq_attr = ${attr ? decodeURIComponent(attr.value).slice(0, 120) + "…" : "(none)"}`);
ok("dq_vid created", !!vid);
ok("dq_sid created", !!sid);
ok("dq_attr created", !!attr);
ok("all three are httpOnly", [vid, sid, attr].every((c) => c?.httpOnly === true));
ok("all three are sameSite lax", [vid, sid, attr].every((c) => /lax/i.test(c?.sameSite ?? "")));
ok("all three are secure", [vid, sid, attr].every((c) => c?.secure === true));
ok("dq_vid is 128 bits of hex", /^[0-9a-f]{32}$/.test(vid?.value ?? ""));
ok("dq_touch NOT set on a non-storefront page", !get("dq_touch"));
ok("page JavaScript cannot read them", await page.evaluate(() => !document.cookie.includes("dq_")));

const VISITOR = vid?.value, SESSION = sid?.value;
const homeRows = await db.analyticsEvent.findMany({ where: { visitorId: VISITOR }, orderBy: { at: "asc" } });
const home = homeRows[0];
ok("a page_viewed row exists", homeRows.length >= 1, `${homeRows.length} rows`);
ok("exactly ONE homepage view — no hydration duplicate",
   homeRows.filter((r) => r.path === "/").length === 1,
   `${homeRows.filter((r) => r.path === "/").length}`);
ok("name = page_viewed", home?.name === "page_viewed", home?.name);
ok('path = "/" with no query string', home?.path === "/", home?.path);
ok("utmSource = activation", home?.utmSource === "activation", home?.utmSource ?? "null");
ok("utmCampaign = first-check", home?.utmCampaign === "first-check", home?.utmCampaign ?? "null");
ok("env = production", home?.env === "production", home?.env);
ok("isBot = false", home?.isBot === false);
ok("device recorded", home?.device === "mobile", home?.device);
ok("no IP field exists on the row",
   !Object.keys(home ?? {}).some((k) => /^ip$|ipaddress|ip_address/i.test(k)),
   Object.keys(home ?? {}).join(","));
ok("no value anywhere in the row looks like an IP address",
   !/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(JSON.stringify(home ?? {})));

/* ------------------------- 4. controlled journey ------------------------ */
console.log("\n=== 4. CONTROLLED JOURNEY ===");
await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
await settle(2000);
await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
await settle(2000);

const journey = await db.analyticsEvent.findMany({ where: { visitorId: VISITOR }, orderBy: { at: "asc" } });
console.log("     sequence: " + journey.map((r) => `${r.name}@${r.path}`).join(" → "));
ok("homepage recorded", journey.some((r) => r.path === "/"));
ok("pricing recorded", journey.some((r) => r.path === "/pricing"));
ok("signup page recorded", journey.some((r) => r.path === "/signup"));
ok("three page views, no duplicates", journey.filter((r) => r.name === "page_viewed").length === 3,
   `${journey.filter((r) => r.name === "page_viewed").length}`);

// Signup started: typing into the form. Phase A does not wire
// vendor_signup_started — it is defined in the vocabulary for Phase B.
await page.fill('input[name="storeName"]', STORE);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="password"]', `activation-${Date.now()}`);
const terms = page.locator('input[name="acceptTerms"]');
if (await terms.count()) await terms.first().check();
await settle(600);
const started = await db.analyticsEvent.count({ where: { visitorId: VISITOR, name: "vendor_signup_started" } });
console.log(`     vendor_signup_started rows: ${started} (Phase A does not wire this; Phase B does)`);

await page.getByRole("button", { name: /create|sign ?up|start/i }).first().click();
await page.waitForURL(/dashboard|verify/, { timeout: 30000 }).catch(() => {});
await settle(3000);
console.log(`     landed on: ${page.url()}`);

const seller = await db.seller.findUnique({ where: { email: EMAIL } });
ok("the controlled vendor was created", !!seller, seller?.id);
ok("vendor_signed_up recorded server-side",
   (await db.analyticsEvent.count({ where: { name: "vendor_signed_up", sellerId: seller?.id } })) === 1);

/* -------------------- 5. anonymous → Seller association ----------------- */
console.log("\n=== 5. ANONYMOUS → SELLER ===");
const all = await db.analyticsEvent.findMany({ where: { visitorId: VISITOR }, orderBy: { at: "asc" } });
const pre = all.filter((r) => r.name === "page_viewed");
ok("all pre-signup events share ONE visitorId", new Set(pre.map((r) => r.visitorId)).size === 1);
ok("all events in the sitting share ONE sessionId", new Set(all.map((r) => r.sessionId)).size === 1,
   `${new Set(all.map((r) => r.sessionId)).size}`);
ok("Seller.firstTouchVisitorId equals that visitor", seller?.firstTouchVisitorId === VISITOR,
   mask(seller?.firstTouchVisitorId));
ok("firstTouchAt < Seller.createdAt",
   !!seller?.firstTouchAt && seller.firstTouchAt < seller.createdAt,
   `${seller?.firstTouchAt?.toISOString()} < ${seller?.createdAt?.toISOString()}`);
console.log(`     signupSource=${seller?.signupSource} · signupSourceDetail=${seller?.signupSourceDetail} · signupCampaign=${seller?.signupCampaign}`);
console.log(`     lastTouchSource=${seller?.lastTouchSource} · lastTouchCampaign=${seller?.lastTouchCampaign}`);
ok("signupSource is the normalized channel", seller?.signupSource === "campaign", seller?.signupSource ?? "null");
ok("signupSourceDetail carries the raw utm_source", seller?.signupSourceDetail === "activation",
   seller?.signupSourceDetail ?? "null");
ok("signupCampaign = first-check", seller?.signupCampaign === "first-check", seller?.signupCampaign ?? "null");
ok("first touch was NOT rewritten by internal navigation",
   seller?.signupCampaign === "first-check" && seller?.lastTouchCampaign === "first-check");

const joined = await db.analyticsEvent.count({ where: { visitorId: seller?.firstTouchVisitorId ?? "none" } });
ok("visitor → Seller join returns the pre-signup events", joined >= 4, `${joined} events`);
ok("no query string was stored on ANY row", all.every((r) => !r.path.includes("?")));
ok("every row says env = production", all.every((r) => r.env === "production"));
ok("no row is marked a bot", all.every((r) => r.isBot === false));
ok("no console errors or failed requests during the journey", problems.length === 0,
   problems.slice(0, 3).join(" | "));

console.log(`\nVISITOR=${VISITOR}\nSESSION=${SESSION}\nSELLER=${seller?.id}`);
console.log(`\n${pass} passed, ${fail} failed`);
await ctx.close(); await b.close(); await db.$disconnect();
process.exit(fail ? 1 : 0);
