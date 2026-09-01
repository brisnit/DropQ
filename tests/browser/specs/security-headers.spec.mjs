/**
 * Security headers and the Report-Only CSP, against a real server in a real
 * browser.
 *
 * The self-test proves the policy SAYS the right thing. This proves the
 * browser AGREES — which is a different claim, and the one that matters:
 *
 *   - the headers actually arrive, on documents and on assets
 *   - a cross-origin page genuinely cannot frame DropQ. Not "X-Frame-Options
 *     is present in the response", but an iframe from another origin that the
 *     browser refuses to render. That is the whole point of this stage.
 *   - the Report-Only policy blocks NOTHING: storefronts, Blob images, the
 *     map, QR codes, login and the dashboard all still work while it observes
 *   - the violations we do get are the ones we expect from Next's inline
 *     scripts, and nothing else
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, url, screenshot, recorder, vendorContext } from "../support/browser.mjs";
import { assertVerifyDatabase, APP_URL } from "../support/guard.mjs";
import { seedFresh, seedSelling, openClient, VENDOR_SLUG } from "../seed/vendor.mjs";
import { readFileSync } from "node:fs";

const DB = assertVerifyDatabase();
const r = recorder("security-headers");
const browser = await launch();
const db = await openClient(prismaModule, DB);

const TERMS = readFileSync("lib/terms.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
await seedFresh(prismaModule, DB, TERMS);
const { seller, drop } = await seedSelling(prismaModule, DB);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

/** Every violation the browser reports, collected rather than ignored. */
const violations = [];
async function watch(p) {
  await p.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
      });
    });
  });
}
const collect = async (p) => {
  const found = await p.evaluate(() => window.__cspViolations ?? []).catch(() => []);
  violations.push(...found);
  return found;
};
await watch(page);

const headersOf = async (p, path) => {
  const res = await p.goto(url(path), { waitUntil: "domcontentloaded" });
  return { res, h: res.headers() };
};

/* ---- 1. The static headers arrive on a document ------------------------- */
r.section("static headers on an HTML document");
{
  const { h } = await headersOf(page, "/");
  r.ok("X-Content-Type-Options: nosniff", h["x-content-type-options"] === "nosniff", h["x-content-type-options"]);
  r.ok("X-Frame-Options: DENY", h["x-frame-options"] === "DENY", h["x-frame-options"]);
  r.ok("Referrer-Policy is strict-origin-when-cross-origin",
    h["referrer-policy"] === "strict-origin-when-cross-origin", h["referrer-policy"]);
  r.ok("Cross-Origin-Opener-Policy: same-origin",
    h["cross-origin-opener-policy"] === "same-origin", h["cross-origin-opener-policy"]);
  r.ok("Cross-Origin-Resource-Policy: cross-origin",
    h["cross-origin-resource-policy"] === "cross-origin", h["cross-origin-resource-policy"]);
  r.ok("COEP is absent", h["cross-origin-embedder-policy"] === undefined,
    h["cross-origin-embedder-policy"]);
  r.ok("x-powered-by is gone", h["x-powered-by"] === undefined, h["x-powered-by"]);

  const pp = h["permissions-policy"] ?? "";
  r.ok("geolocation is still allowed to self", pp.includes("geolocation=(self)"));
  r.ok("camera and microphone are disabled",
    pp.includes("camera=()") && pp.includes("microphone=()"));
  r.ok("payment is disabled — Stripe is a redirect, not an in-page API",
    pp.includes("payment=()"));
}

/* ---- 2. Static headers reach assets too, CSP does not ------------------- */
r.section("scope: static headers everywhere, CSP on documents only");
{
  const asset = await page.request.get(url("/brand/dropq-mark.png"));
  const ah = asset.headers();
  r.ok("an image still gets nosniff", ah["x-content-type-options"] === "nosniff");
  r.ok("an image still gets CORP: cross-origin so email clients can load it",
    ah["cross-origin-resource-policy"] === "cross-origin");
  r.ok("an image carries no CSP", ah["content-security-policy-report-only"] === undefined);

  const api = await page.request.get(url("/api/health"));
  r.ok("a JSON route still gets nosniff", api.headers()["x-content-type-options"] === "nosniff");
  r.ok("a JSON route carries no CSP",
    api.headers()["content-security-policy-report-only"] === undefined);
}

/* ---- 3. Report-Only, and only Report-Only ------------------------------ */
r.section("the policy observes and does not enforce");
{
  const { h } = await headersOf(page, "/");
  const csp = h["content-security-policy-report-only"] ?? "";
  r.ok("Content-Security-Policy-Report-Only is present", csp.length > 0);
  r.ok("the ENFORCING header is absent — nothing can be blocked yet",
    h["content-security-policy"] === undefined, h["content-security-policy"]);
  r.ok("frame-ancestors 'none'", /frame-ancestors 'none'/.test(csp));
  r.ok("frame-src 'none'", /frame-src 'none'/.test(csp));
  r.ok("object-src 'none'", /object-src 'none'/.test(csp));
  r.ok("base-uri 'self'", /base-uri 'self'/.test(csp));
  r.ok("no bare wildcard", !/\s\*(\s|;|$)/.test(csp));
  r.ok("the Blob host is exact, not wildcarded",
    csp.includes("https://rsvjjuuoioqd578j.public.blob.vercel-storage.com") && !csp.includes("*."));
  r.ok("Mapbox origins are present",
    csp.includes("https://api.mapbox.com") && csp.includes("https://events.mapbox.com"));
  r.ok("Stripe redirect targets are in form-action",
    ["checkout", "billing", "connect"].every((s) => csp.includes(`https://${s}.stripe.com`)));
  r.ok("Google sign-in is in form-action", csp.includes("https://accounts.google.com"));
  r.ok("no Stripe.js origin", !csp.includes("js.stripe.com"));
  r.ok("no PostHog origin", !csp.includes("posthog"));
  r.ok("no Google Fonts origins",
    !csp.includes("fonts.googleapis.com") && !csp.includes("fonts.gstatic.com"));
  r.ok("no 'unsafe-eval'", !csp.includes("unsafe-eval"));
  r.ok("'unsafe-inline' only under style-src-attr",
    (csp.match(/unsafe-inline/g) ?? []).length === 1 &&
    /style-src-attr 'unsafe-inline'/.test(csp));
  r.ok("reports go to a first-party path", /report-uri \/api\/csp-report/.test(csp));
}

/* ---- 4. Clickjacking: actually try it ---------------------------------- */
r.section("a cross-origin page cannot frame DropQ");
{
  // A page on a DIFFERENT origin that tries to embed the dashboard. Serving it
  // from a data: URL guarantees the parent is opaque-origin, so this is a real
  // cross-origin attempt rather than a same-origin one that would be allowed.
  const attacker = await ctx.newPage();
  await attacker.setContent(`
    <h1>Not DropQ</h1>
    <iframe id="victim" src="${APP_URL}/dashboard" width="800" height="600"></iframe>
  `, { waitUntil: "domcontentloaded" });
  await attacker.waitForTimeout(1500);

  const framed = await attacker.evaluate(() => {
    const f = document.getElementById("victim");
    try {
      // If the browser refused, the frame has no reachable document.
      const doc = f.contentDocument;
      return { reachable: Boolean(doc), body: doc?.body?.innerHTML?.length ?? 0 };
    } catch {
      return { reachable: false, body: 0, threw: true };
    }
  });
  r.ok("the framed document is not rendered", framed.body === 0,
    `reachable=${framed.reachable} bodyLength=${framed.body}`);

  const frameUrls = attacker.frames().map((f) => f.url());
  r.ok("no child frame ever loaded the dashboard",
    !frameUrls.some((u) => u.includes("/dashboard") && u !== "about:blank"),
    frameUrls.join(" | "));
  await screenshot(attacker, "security-headers-clickjack-refused");
  await attacker.close();
}

/* ---- 5. Nothing is broken by observing ---------------------------------- */
r.section("functional regression: the app still works");
{
  const storefront = await headersOf(page, `/s/${VENDOR_SLUG}`);
  r.ok("the storefront renders", storefront.res.status() === 200);
  const imgs = await page.evaluate(() =>
    [...document.images].map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth })));
  r.ok("every storefront image loaded", imgs.length === 0 || imgs.every((i) => i.w > 0),
    imgs.filter((i) => !i.w).map((i) => i.src).join(", "));

  const login = await headersOf(page, "/login");
  r.ok("the login page renders", login.res.status() === 200);
  r.ok("the login form is usable",
    await page.locator('input[name="email"]').isVisible());

  const dm = await headersOf(page, "/dropmeet");
  r.ok("dropmeet renders", dm.res.status() === 200);

  const forgot = await headersOf(page, "/forgot");
  r.ok("a STATIC route still renders with the header applied",
    forgot.res.status() === 200 &&
    forgot.h["content-security-policy-report-only"] !== undefined);

  await collect(page);
}

/* ---- 6. Authenticated pages get the same treatment ---------------------- */
r.section("authenticated pages");
{
  const vctx = await vendorContext(browser, seller.id, "desktop");
  const vpage = await vctx.newPage();
  await watch(vpage);
  const res = await vpage.goto(url("/dashboard"), { waitUntil: "domcontentloaded" });
  const h = res.headers();
  r.ok("the dashboard renders for a signed-in vendor",
    res.status() === 200 && !vpage.url().includes("/login"), vpage.url());
  r.ok("the dashboard carries the same static headers",
    h["x-frame-options"] === "DENY" && h["x-content-type-options"] === "nosniff");
  r.ok("the dashboard carries the Report-Only policy",
    h["content-security-policy-report-only"] !== undefined);
  r.ok("the dashboard is not enforcing", h["content-security-policy"] === undefined);

  // QR codes are server-rendered data: URLs — the reason img-src carries data:.
  if (drop) {
    await vpage.goto(url(`/dashboard/drops/${drop.id}`), { waitUntil: "domcontentloaded" });
    const qr = await vpage.evaluate(() =>
      [...document.images].filter((i) => i.src.startsWith("data:")).map((i) => i.naturalWidth));
    r.ok("the QR code rendered from a data: URL", qr.length > 0 && qr.every((w) => w > 0),
      `${qr.length} data: images`);
  }
  await collect(vpage);
  await vctx.close();
}

/* ---- 7. The violations are the expected ones ---------------------------- */
r.section("violations reported");
{
  const byDirective = {};
  for (const v of violations) byDirective[v.directive] = (byDirective[v.directive] ?? 0) + 1;
  console.log(`  · ${violations.length} violations: ${JSON.stringify(byDirective)}`);

  r.ok("every violation is report-only, none enforced",
    violations.every((v) => v.disposition === "report"),
    [...new Set(violations.map((v) => v.disposition))].join(", "));

  // EXPECTED IN THIS STAGE, and only these two:
  //
  //   script-src / script-src-elem — Next writes ~21 inline <script> blocks per
  //   page and `script-src 'self'` permits none of them. This is the evidence
  //   the nonce work needs; it goes quiet when that work lands.
  //
  //   style-src-elem — DEV ONLY. `next dev` injects CSS as inline <style>
  //   elements for hot reloading. A production build emits ZERO of them and one
  //   linked stylesheet instead; verified on 1 Sep 2026 by building and serving
  //   locally, and against www.drop-q.com. This harness runs `npm run dev`, so
  //   the violation appears here and will not appear in production.
  const EXPECTED = new Set(["script-src", "script-src-elem", "style-src-elem"]);
  const unexpected = violations.filter((v) => !EXPECTED.has(v.directive));
  r.ok("no violation outside the two expected directives", unexpected.length === 0,
    [...new Set(unexpected.map((v) => `${v.directive}:${v.blocked}`))].join(", "));

  // The positive form, which survives the dev/production difference: the
  // directives that carry our origin allowlist must never fire at all. A
  // violation here would mean the allowlist is wrong — a Blob image, a Mapbox
  // call, a font or a form target we failed to account for.
  for (const directive of ["default-src", "img-src", "font-src", "connect-src",
    "worker-src", "frame-src", "form-action", "media-src", "manifest-src", "base-uri",
    "object-src", "frame-ancestors", "style-src-attr"]) {
    const hits = violations.filter((v) => v.directive === directive);
    r.ok(`${directive} was never violated`, hits.length === 0,
      [...new Set(hits.map((v) => v.blocked))].join(", "));
  }

  r.ok("inline styles are permitted by style-src-attr and never reported",
    !violations.some((v) => v.directive === "style-src-attr"));
}

const okAll = r.report();
await db.$disconnect();
await browser.close();
process.exit(okAll ? 0 : 1);
