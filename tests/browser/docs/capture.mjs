#!/usr/bin/env node
/**
 * Help screenshot pipeline.
 *
 *   npm run help:screenshots          regenerate every image + the manifest
 *   npm run help:screenshots:check    verify without regenerating
 *
 * Boots the isolated stack, seeds the Cedar & Salt documentation vendor,
 * walks it through three product states, and captures the real DropQ UI with a
 * subtle highlight drawn over the element each step is about.
 *
 * ⚠️ SAFETY. This is the same harness the browser suite uses, with the same
 * guard: the seeder refuses any database that is not the throwaway one, and the
 * app is started with an explicit DATABASE_URL so it cannot inherit the
 * production one from `.env`. On top of that, every captured page is scanned
 * for anything that must never appear in documentation (see SECRET_PATTERNS)
 * and the capture aborts rather than writing a leaking image.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import prismaModule from "../../../app/generated/prisma/index.js";
import { startStack, ROOT } from "../support/stack.mjs";
import { APP_URL } from "../support/guard.mjs";
import { sessionCookie } from "../support/session.mjs";
import { SHOTS, SCENES } from "./shots.mjs";
import { sceneNew, sceneDraft, sceneLive, DOCS_SLUG, DOCS_STORE, DOCS_NOW, openClient } from "../seed/docs-vendor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(ROOT, "public", "help");
const MANIFEST = join(OUT_DIR, "manifest.json");
const CHECK = process.argv.includes("--check");

/** What a vendor's own share links actually look like. */
const PUBLIC_ORIGIN = "https://www.drop-q.com";

/** Documentation viewport. Mobile first — most vendors are on a phone. */
const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
};

/**
 * Things that must never reach a documentation image.
 *
 * Belt and braces: the fixture data contains none of this, but a screenshot is
 * published to the open web and a regression in seeding must not become a leak.
 */
const SECRET_PATTERNS = [
  [/sk_live_[A-Za-z0-9]/, "live Stripe secret key"],
  [/sk_test_[A-Za-z0-9]{10}/, "Stripe secret key"],
  [/whsec_[A-Za-z0-9]/, "Stripe webhook secret"],
  [/rk_(live|test)_/, "Stripe restricted key"],
  [/hp_session=/, "session cookie"],
  [/postgres(ql)?:\/\//, "database URL"],
  [/BEGIN [A-Z ]*PRIVATE KEY/, "private key"],
];

/** Addresses that are safe in documentation. Anything else is suspect. */
const SAFE_EMAIL = /@(example\.(com|org|net)|cedar-and-salt\.example\.com)/i;

const log = (...a) => console.log(...a);
const fail = (m) => { console.error("\n✗ " + m); process.exitCode = 1; };

/* --------------------------- annotation overlay -------------------------- */

/**
 * Draw the highlight, in the page, immediately before the capture.
 *
 * A DOM overlay rather than anything baked into the product: documentation
 * annotations must never be shippable UI, and drawing them at capture time
 * means they are regenerated with the screenshot instead of being frozen into
 * pixels that outlive the layout.
 *
 * Restrained on purpose — an outline, a soft dim, and a small numbered marker.
 * No arrows, no callout bubbles, no text baked into the image (captions live in
 * the article, where they can be edited and translated).
 */
/**
 * Bring the target into view, INSTANTLY.
 *
 * `app/globals.css` sets `html { scroll-behavior: smooth }`, so a plain
 * scrollIntoView animates — and a `getBoundingClientRect()` read on the next
 * line returns the pre-scroll position. The overlay was then drawn at
 * coordinates far below the viewport, dimming the whole screen and
 * highlighting nothing. `behavior: "instant"` overrides the CSS.
 */
const SCROLL_TO = (selector) => {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  return true;
};

const ANNOTATE = ({ selector, marker }) => {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, reason: "element not found: " + selector };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, reason: "element has no box" };

  const pad = 6;
  const box = document.createElement("div");
  box.setAttribute("data-doc-annotation", "");
  Object.assign(box.style, {
    position: "fixed",
    left: `${r.left - pad}px`, top: `${r.top - pad}px`,
    width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
    border: "2px solid #ff6268", borderRadius: "12px",
    boxShadow: "0 0 0 9999px rgba(26,26,26,0.28)",
    zIndex: "2147483000", pointerEvents: "none",
  });
  document.body.appendChild(box);

  if (marker) {
    const dot = document.createElement("div");
    dot.setAttribute("data-doc-annotation", "");
    Object.assign(dot.style, {
      position: "fixed",
      left: `${Math.max(4, r.left - pad - 13)}px`,
      top: `${Math.max(4, r.top - pad - 13)}px`,
      width: "26px", height: "26px", borderRadius: "999px",
      background: "#ff6268", color: "#fff",
      font: "700 14px/26px ui-sans-serif, system-ui, sans-serif",
      textAlign: "center", zIndex: "2147483001", pointerEvents: "none",
      boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
    });
    dot.textContent = String(marker);
    document.body.appendChild(dot);
  }
  return { ok: true, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
};

const CLEAR_ANNOTATIONS = () =>
  document.querySelectorAll("[data-doc-annotation]").forEach((n) => n.remove());

/**
 * The public origin shown in documentation.
 *
 * The harness serves on localhost, so a share link renders as
 * `http://localhost:3123/s/…` — which teaches a vendor nothing and looks
 * broken in published docs. This rewrites ONLY the origin, in text nodes, to
 * the address a real vendor actually sees.
 *
 * ⚠️ This is the one and only cosmetic change made to a captured page, it is
 * recorded in the manifest as `rewrites: ["origin"]`, and it makes the image
 * MORE accurate rather than less. Nothing else about a screenshot is doctored:
 * no fabricated numbers, no invented UI, no edited copy.
 */
const REWRITE_ORIGIN = ({ from, to }) => {
  let n = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const node of nodes) {
    if (node.nodeValue && node.nodeValue.includes(from)) {
      node.nodeValue = node.nodeValue.split(from).join(to);
      n++;
    }
  }
  return n;
};

/** Blank anything explicitly marked as not-for-documentation. */
const APPLY_REDACTIONS = () =>
  document.querySelectorAll("[data-help-redact]").forEach((n) => {
    n.style.filter = "blur(7px)";
    n.style.userSelect = "none";
  });

/* ------------------------------- check mode ------------------------------ */

function runCheck() {
  log("• checking the screenshot set\n");
  let problems = 0;
  const problem = (m) => { problems++; console.log("  ✗ " + m); };

  if (!existsSync(MANIFEST)) {
    problem("no manifest at public/help/manifest.json — run `npm run help:screenshots`");
    return problems;
  }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const byId = new Map(manifest.shots.map((s) => [s.id, s]));

  // 1. Every defined shot has a manifest entry and a file on disk.
  for (const s of SHOTS) {
    const entry = byId.get(s.id);
    if (!entry) { problem(`shot "${s.id}" has no manifest entry`); continue; }
    const file = resolve(ROOT, "public", entry.file.replace(/^\//, ""));
    if (!existsSync(file)) { problem(`shot "${s.id}" file missing: ${entry.file}`); continue; }
    const size = statSync(file).size;
    // A capture that failed silently tends to be a near-empty PNG.
    if (size < 5_000) problem(`shot "${s.id}" looks like a failed capture (${size} bytes)`);
  }

  // 2. No orphan manifest entries or orphan files.
  const defined = new Set(SHOTS.map((s) => s.id));
  for (const s of manifest.shots) {
    if (!defined.has(s.id)) problem(`manifest has "${s.id}" but shots.mjs does not define it`);
  }

  // 3. Every anchor a shot highlights still exists in the registry.
  const guidanceSrc = readFileSync(join(ROOT, "lib", "guidance.ts"), "utf8");
  const anchorBlock = guidanceSrc.split("export const ANCHORS = {")[1]?.split("} as const;")[0] ?? "";
  const knownAnchors = new Set([...anchorBlock.matchAll(/"([^"]+)":/g)].map((m) => m[1]));
  for (const s of SHOTS) {
    if (s.anchor && !knownAnchors.has(s.anchor)) {
      problem(`shot "${s.id}" highlights anchor "${s.anchor}", which no longer exists`);
    }
  }

  // 4. Every article a shot claims to illustrate exists, and every screenshot
  //    an article references was actually defined.
  const helpSrc = readFileSync(join(ROOT, "lib", "help", "content.ts"), "utf8");
  const slugs = new Set([...helpSrc.matchAll(/^\s{4}slug: "([^"]+)"/gm)].map((m) => m[1]));
  for (const s of SHOTS) {
    if (!slugs.has(s.article)) problem(`shot "${s.id}" targets article "${s.article}", which does not exist`);
  }
  const referenced = new Set([...helpSrc.matchAll(/shot: "([^"]+)"/g)].map((m) => m[1]));
  for (const id of referenced) {
    if (!defined.has(id)) problem(`an article references screenshot "${id}", which is not defined`);
  }
  // …and the other direction: an image nothing shows is an image nobody
  // reviews, which is how a stale screenshot survives a redesign.
  for (const s of SHOTS) {
    if (!referenced.has(s.id)) problem(`screenshot "${s.id}" is captured but no article shows it`);
  }

  // 5. Routes a shot visits must still be real app routes.
  for (const s of SHOTS) {
    const routePath = s.route.replace(/:dropId/, "x");
    const appPath = join(ROOT, "app", routePath.replace(/^\//, ""));
    const dynamic = s.route.includes(":dropId");
    const exists = dynamic
      ? existsSync(join(ROOT, "app", "dashboard", "drops", "[id]", "page.tsx"))
      : existsSync(join(appPath, "page.tsx"));
    if (!exists) problem(`shot "${s.id}" points at route "${s.route}", which no longer resolves`);
  }

  if (problems === 0) {
    log(`  ✓ ${SHOTS.length} screenshots, ${manifest.shots.length} manifest entries, all present and resolvable`);
    log(`  ✓ generated ${manifest.generatedAt}`);
    log("\n✅ screenshot set is consistent");
    log("   (this proves the images EXIST and resolve — it cannot prove they are");
    log("    still ACCURATE. Look at them after a UI change.)");
  } else {
    log(`\n❌ ${problems} problem(s). Run \`npm run help:screenshots\` to regenerate.`);
  }
  return problems;
}

/* -------------------------------- capture -------------------------------- */

async function capture() {
  // The app imports public/help/manifest.json, so it must exist before the app
  // compiles — including the very first time this runs, when there is nothing
  // to describe yet. An empty manifest renders articles without pictures; a
  // missing one is a build error on every page that mounts Help.
  if (!existsSync(MANIFEST)) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(MANIFEST, JSON.stringify({ generatedAt: null, shots: [] }, null, 2) + "\n");
    log("• no manifest yet — wrote an empty one so the app can build");
  }

  log("• starting isolated stack…");
  // The app renders share links and QR codes from APP_URL, so pointing it at the
  // canonical origin makes both honest in the images — the QR is a server-built
  // PNG that no amount of DOM rewriting could have corrected.
  const stack = await startStack({
    verbose: !!process.env.BROWSER_VERBOSE,
    appUrl: PUBLIC_ORIGIN,
  });
  const termsVersion = readFileSync(join(ROOT, "lib", "terms.ts"), "utf8")
    .match(/TERMS_VERSION = "([^"]+)"/)[1];
  let browser;
  try {
    log("• seeding the documentation vendor…");
    const seller = await sceneNew(prismaModule, stack.url, termsVersion);
    const db = await openClient(prismaModule, stack.url);

    browser = await chromium.launch({ channel: "chrome" });
    // Deliberately NOT a wipe-then-write. The app imports
    // public/help/manifest.json, so deleting it up front makes every page that
    // mounts Help fail to compile — including the dashboard we are about to
    // photograph. Overwrite in place, write the manifest last, then sweep
    // whatever the new manifest no longer references.
    mkdirSync(OUT_DIR, { recursive: true });

    const entries = [];
    let dropId = null;

    for (const scene of SCENES) {
      if (scene === "draft") ({ drop: { id: dropId } } = await sceneDraft(prismaModule, stack.url));
      if (scene === "live") await sceneLive(prismaModule, stack.url);
      const shots = SHOTS.filter((s) => s.scene === scene);
      if (shots.length === 0) continue;
      log(`\n• scene "${scene}" — ${shots.length} shot(s)`);

      for (const shot of shots) {
        const vpName = shot.viewport ?? "mobile";
        const vp = VIEWPORTS[vpName];
        const ctx = await browser.newContext({
          viewport: vp, isMobile: vpName === "mobile", hasTouch: vpName === "mobile",
          deviceScaleFactor: 2, reducedMotion: "reduce",
        });
        // Freeze the clock so screenshots are reproducible. Without it the date
        // picker opens on the real current month and every image churns when
        // the month rolls over, for no change in the product.
        // `setFixedTime` only pins Date.now(); it does NOT take over timers, so
        // the dashboard's polling and countdowns keep working normally.
        await ctx.clock.setFixedTime(DOCS_NOW);
        await ctx.addCookies([sessionCookie(seller.id)]);
        await ctx.addInitScript(() => {
          const hide = () => {
            const s = document.createElement("style");
            s.textContent =
              "[data-nextjs-dev-tools-button],nextjs-portal,#next-logo{display:none !important}";
            document.head?.appendChild(s);
          };
          document.head ? hide() : document.addEventListener("DOMContentLoaded", hide);
        });
        const page = await ctx.newPage();
        const route = shot.route.replace(":dropId", dropId ?? "");
        await page.goto(APP_URL + route, { waitUntil: "networkidle" });
        await page.waitForTimeout(450);

        /* ---- safety scan BEFORE anything is written to disk ---- */
        const html = await page.content();
        for (const [re, what] of SECRET_PATTERNS) {
          if (re.test(html)) throw new Error(`REFUSING TO CAPTURE "${shot.id}": page contains a ${what}`);
        }
        const emails = [...new Set(html.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])]
          .filter((e) => !SAFE_EMAIL.test(e) && !e.endsWith(".png") && !e.includes("schema"));
        if (emails.length) throw new Error(`REFUSING TO CAPTURE "${shot.id}": unsafe address(es) ${emails.join(", ")}`);
        const visible = await page.evaluate(() => document.body.innerText);
        if (/Grandies|Britts Bunnies|Casa Makulay|Marble & Crumb|Clovery|Paraiso|California Vintage/i.test(visible)) {
          throw new Error(`REFUSING TO CAPTURE "${shot.id}": a real vendor name is on screen`);
        }

        await page.evaluate(APPLY_REDACTIONS);
        const rewrote = await page.evaluate(REWRITE_ORIGIN, { from: APP_URL, to: PUBLIC_ORIGIN });

        /* ---- annotate ---- */
        const selector = shot.anchor
          ? `[data-guidance-anchor="${shot.anchor}"]`
          : shot.selector ?? null;
        let target = selector;
        // Prefer role+name where a shot names one: plain text matching finds
        // the first mention on the page, which is often the sentence ABOUT the
        // control rather than the control itself.
        if (!target && shot.role) {
          const byRole = page.getByRole(shot.role, { name: shot.roleName, exact: true }).first();
          if ((await byRole.count()) === 0) {
            throw new Error(`shot "${shot.id}": no ${shot.role} named "${shot.roleName}" on ${route}`);
          }
          const handle = await byRole.elementHandle();
          await handle.evaluate((el) => el.setAttribute("data-doc-target", ""));
          target = "[data-doc-target]";
        }
        if (!target && shot.selectorText) {
          const byText = page.getByText(shot.selectorText, { exact: false }).first();
          if ((await byText.count()) === 0) {
            const seen = (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400);
            throw new Error(
              `shot "${shot.id}": no element matching text "${shot.selectorText}" on ${route}\n` +
              `  page said: ${seen}`
            );
          }
          const handle = await byText.elementHandle();
          if (!handle) throw new Error(`shot "${shot.id}": text "${shot.selectorText}" matched but had no element`);
          await handle.evaluate((el) => el.setAttribute("data-doc-target", ""));
          target = "[data-doc-target]";
        }
        // Scroll first, settle, THEN measure and draw.
        if (!(await page.evaluate(SCROLL_TO, target))) {
          const seen = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500);
          throw new Error(
            `shot "${shot.id}": element not found: ${target} on ${route}\n  page said: ${seen}`
          );
        }
        await page.waitForTimeout(250);
        const ann = await page.evaluate(ANNOTATE, { selector: target, marker: shot.marker ?? null });
        if (!ann.ok) throw new Error(`shot "${shot.id}": ${ann.reason}`);
        // The highlight must actually be on screen, or the image dims the whole
        // page and points at nothing.
        if (ann.rect.y < -1 || ann.rect.y + ann.rect.h > vp.height + 1) {
          throw new Error(
            `shot "${shot.id}": highlight is off-screen (y=${Math.round(ann.rect.y)}, ` +
            `h=${Math.round(ann.rect.h)}, viewport ${vp.height})`
          );
        }
        // A highlight that swallows the screen teaches nothing — it means the
        // shot is pointing at a container rather than a control.
        const coverage = (ann.rect.w * ann.rect.h) / (vp.width * vp.height);
        if (coverage > 0.55) {
          throw new Error(
            `shot "${shot.id}": highlight covers ${Math.round(coverage * 100)}% of the screen ` +
            `(${Math.round(ann.rect.w)}×${Math.round(ann.rect.h)}) — point it at a control, not a container`
          );
        }
        await page.waitForTimeout(120);

        const rel = `/help/${shot.article}/${shot.id}.png`;
        const file = resolve(ROOT, "public", rel.replace(/^\//, ""));
        mkdirSync(dirname(file), { recursive: true });
        await page.screenshot({ path: file });
        await page.evaluate(CLEAR_ANNOTATIONS);

        const bytes = readFileSync(file);
        entries.push({
          id: shot.id,
          article: shot.article,
          file: rel,
          route,
          scene,
          viewport: vpName,
          width: vp.width,
          height: vp.height,
          highlight: shot.anchor ? { kind: "anchor", value: shot.anchor }
            : shot.selector ? { kind: "selector", value: shot.selector }
            : { kind: "text", value: shot.selectorText },
          marker: shot.marker ?? null,
          caption: shot.caption,
          highlightRect: {
            x: Math.round(ann.rect.x), y: Math.round(ann.rect.y),
            w: Math.round(ann.rect.w), h: Math.round(ann.rect.h),
          },
          rewrites: rewrote > 0 ? ["origin"] : [],
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex").slice(0, 16),
        });
        log(`  ✓ ${shot.id}  (${vpName}, ${Math.round(bytes.length / 1024)}kB)`);
        await ctx.close();
      }
    }

    writeFileSync(MANIFEST, JSON.stringify({
      generatedAt: new Date().toISOString(),
      vendor: { store: DOCS_STORE, slug: DOCS_SLUG, fictional: true },
      note: "Generated by tests/browser/docs/capture.mjs. Do not edit by hand.",
      shots: entries,
    }, null, 2) + "\n");

    // Sweep files from a previous run that nothing references any more.
    const keep = new Set(entries.map((e) => join(ROOT, "public", e.file.replace(/^\//, ""))));
    keep.add(MANIFEST);
    for (const dir of readdirSync(OUT_DIR)) {
      const dirPath = join(OUT_DIR, dir);
      if (!statSync(dirPath).isDirectory()) continue;
      for (const f of readdirSync(dirPath)) {
        const full = join(dirPath, f);
        if (!keep.has(full)) {
          rmSync(full);
          log(`  – removed stale ${dir}/${f}`);
        }
      }
      if (readdirSync(dirPath).length === 0) rmSync(dirPath, { recursive: true });
    }

    log(`\n✅ ${entries.length} screenshots → public/help/`);
    log(`   manifest → public/help/manifest.json`);
    await db.$disconnect();
  } finally {
    if (browser) await browser.close();
    await stack.stop();
  }
}

if (CHECK) {
  const problems = runCheck();
  process.exit(problems === 0 ? 0 : 1);
} else {
  await capture();
}
