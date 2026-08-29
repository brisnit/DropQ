/**
 * The Help Center, in a real browser.
 *
 * Covers the things the content self-test cannot: that Help opens without
 * navigating the vendor away, that search works as typed, that the panel is
 * reachable on a phone, and that the tour can be restarted from it without
 * touching activation progress.
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, vendorContext, url, screenshot, noHorizontalOverflow, overflowingChildren, recorder, guidanceReady } from "../support/browser.mjs";
import { assertVerifyDatabase } from "../support/guard.mjs";
import { seedFresh, seedSelling, settleGuidance, silenceGuidance, openClient, VENDOR_SLUG } from "../seed/vendor.mjs";
import { readFileSync } from "node:fs";

const DB = assertVerifyDatabase();
const TERMS = readFileSync("lib/terms.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
const r = recorder("help");
const browser = await launch();
const db = await openClient(prismaModule, DB);

for (const viewport of ["mobile", "desktop"]) {
  r.section(`${viewport.toUpperCase()} — help centre`);
  const seller = await seedFresh(prismaModule, DB, TERMS);
  await settleGuidance(prismaModule, DB, seller.id);
  const ctx = await vendorContext(browser, seller.id, viewport);
  const page = await ctx.newPage();
  const panel = page.locator('[role="dialog"]');

  /* ------------------------- opening Help ------------------------- */
  await page.goto(url("/dashboard/orders"), { waitUntil: "networkidle" });
  const before = page.url();

  if (viewport === "mobile") {
    // On a phone Help must also be reachable from the menu.
    await page.getByRole("button", { name: "Open menu" }).click();
    // `.last()`: the header trigger and the menu item share an accessible name,
    // and the menu renders after the header in DOM order.
    await page.getByRole("button", { name: "Help" }).last().click();
  } else {
    await page.getByRole("button", { name: "Help" }).first().click();
  }
  await guidanceReady(page, "dialog");
  r.ok("Help opens", await panel.isVisible());
  r.ok("Help does not navigate the vendor away", page.url() === before);
  r.ok("no horizontal clipping with Help open", await noHorizontalOverflow(page));
  await screenshot(page, `${viewport}-help-panel`);

  // Lower-cased: the category headings are `uppercase` in CSS, and Chrome's
  // innerText returns the transformed text.
  const panelText = (await panel.innerText()).toLowerCase();
  for (const cat of ["Getting started", "Creating drops", "Products", "Payments & Stripe",
                     "Orders", "QR codes & sharing", "Customers", "Account & plan",
                     "Troubleshooting"]) {
    r.ok(`Help lists "${cat}"`, panelText.includes(cat.toLowerCase()));
  }
  r.ok("Help suggests articles for the current page", panelText.includes("on this page"));
  r.ok("the Orders page suggests order help", panelText.includes("where your orders appear"));
  r.ok("walk-up help is hidden without the capability", !panelText.includes("walk-up sales"));
  r.ok("Help offers the tour", panelText.includes("dropq tour"));
  r.ok("Help links to the full centre", panelText.includes("full help centre"));

  /* ---------------------------- search ---------------------------- */
  const search = panel.getByPlaceholder("Search help…");
  await search.fill("stripe");
  await page.waitForTimeout(350);
  const stripeResults = await panel.innerText();
  r.ok("searching 'stripe' returns results", /result/i.test(stripeResults));
  r.ok("searching 'stripe' surfaces Stripe help", /Connecting Stripe/i.test(stripeResults));
  await screenshot(page, `${viewport}-help-search`);

  await search.fill("zzzqqxx");
  await page.waitForTimeout(350);
  r.ok("a nonsense search says so plainly", /No matches/i.test(await panel.innerText()));

  await search.fill("qr");
  await page.waitForTimeout(350);
  r.ok("searching 'qr' surfaces the QR article", /QR code/i.test(await panel.innerText()));

  /* -------------------------- an article -------------------------- */
  await search.fill("");
  await page.waitForTimeout(250);
  await panel.getByRole("button", { name: /What a drop is/ }).click();
  await page.waitForTimeout(300);
  const article = await panel.innerText();
  r.ok("an article opens inside the panel", /What a drop is/.test(article));
  r.ok("the article has real content", article.length > 300);
  r.ok("the article offers related reading", /Related/i.test(article));
  r.ok("the article can be left", await panel.getByRole("button", { name: /All help/ }).isVisible());
  await screenshot(page, `${viewport}-help-article`);

  /* ---------------------------- escape ---------------------------- */
  await panel.press("Escape");
  await page.waitForTimeout(350);
  r.ok("Escape closes Help", !(await panel.isVisible()));
  r.ok("closing Help leaves the vendor where they were", page.url() === before);

  await ctx.close();
}

/* -------------------- tour restart from Help -------------------- */
r.section("TOUR FROM HELP");
{
  const seller = await seedFresh(prismaModule, DB, TERMS);
  await settleGuidance(prismaModule, DB, seller.id);
  await seedSelling(prismaModule, DB);
  const withDrop = await db.seller.findFirstOrThrow({ where: { slug: VENDOR_SLUG } });
  await settleGuidance(prismaModule, DB, withDrop.id);

  const beforeDrops = await db.drop.count({ where: { sellerId: withDrop.id } });
  const beforeShared = (await db.vendorGuidance.findUnique({ where: { sellerId: withDrop.id } }))?.sharedAt ?? null;

  const ctx = await vendorContext(browser, withDrop.id, "desktop");
  const page = await ctx.newPage();
  await page.goto(url("/dashboard"), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Help" }).first().click();
  await guidanceReady(page, "dialog");
  await page.getByRole("button", { name: /DropQ tour/i }).click();
  await guidanceReady(page, "note");
  r.ok("the tour starts from Help", (await page.locator('[role="note"]').innerText()).includes("1 of 6"));
  r.ok("Help closes when the tour starts", !(await page.locator('[role="dialog"]').isVisible()));

  const row = await db.vendorGuidance.findUnique({ where: { sellerId: withDrop.id } });
  r.ok("the tour is recorded as in progress", row?.tourStatus === "in_progress");
  r.ok("restarting the tour does not change drops",
    (await db.drop.count({ where: { sellerId: withDrop.id } })) === beforeDrops);
  r.ok("restarting the tour does not reset the share milestone",
    (row?.sharedAt ?? null)?.toString() === (beforeShared ?? null)?.toString());
  await ctx.close();
}

/* ------------------------ the public route ----------------------- */
r.section("PUBLIC /help");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const res = await page.goto(url("/help"), { waitUntil: "networkidle" });
  r.ok("/help is publicly reachable", res?.status() === 200, `status=${res?.status()}`);
  const body = await page.locator("main").innerText();
  r.ok("/help lists categories", /Getting started/.test(body) && /Troubleshooting/.test(body));
  r.ok("/help hides capability-gated help from the public", !/Walk-up sales/i.test(body));
  await screenshot(page, "public-help-index");

  const article = await page.goto(url("/help/drop-types"), { waitUntil: "networkidle" });
  r.ok("an article page renders", article?.status() === 200);
  r.ok("the article says the choice is permanent",
    /cannot be changed after a drop is created/i.test(await page.locator("main").innerText()));
  const gated = await page.goto(url("/help/what-is-walkup"), { waitUntil: "networkidle" });
  r.ok("a gated article 404s for the public", gated?.status() === 404, `status=${gated?.status()}`);
  await screenshot(page, "public-help-article");
  await ctx.close();
}

/* --------------------- illustrated walkthroughs ------------------- */
/**
 * Phase 5. The screenshots have to survive the trip into the page: load at all,
 * stay inside their container at 320px, and appear in BOTH places an article is
 * read — the in-dashboard panel and the public route.
 */
{
  const manifest = JSON.parse(readFileSync("public/help/manifest.json", "utf8"));
  const ILLUSTRATED = [...new Set(manifest.shots.map((s) => s.article))];
  r.section("ILLUSTRATED ARTICLES");

  // Widest and narrowest phone we support, plus desktop. 320 is where the
  // activation card clipped in production, so every new image is checked there.
  for (const width of [320, 390, 1280]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    for (const slug of ILLUSTRATED) {
      const res = await page.goto(url(`/help/${slug}`), { waitUntil: "networkidle" });
      r.ok(`${width}px /help/${slug} renders`, res?.status() === 200, `status=${res?.status()}`);

      // The images are lazy, so the ones below the fold have not started
      // loading yet — which is the point of lazy, and also what a vendor sees
      // as they read down. Bring each into view the way reading would.
      // (`window.scrollTo` is useless here: the app sets scroll-behavior:
      // smooth, so a scroll loop returns before anything has moved.)
      const shown = page.locator("main img");
      for (let k = 0, n = await shown.count(); k < n; k++) {
        await shown.nth(k).scrollIntoViewIfNeeded();
      }
      await page
        .waitForFunction(
          () => [...document.querySelectorAll("main img")].every((i) => i.complete),
          null,
          { timeout: 15_000 }
        )
        .catch(() => {});

      const imgs = await page.evaluate(() =>
        [...document.querySelectorAll("main img")].map((i) => ({
          src: new URL(i.currentSrc || i.src).pathname,
          loaded: i.complete && i.naturalWidth > 0,
          alt: i.alt,
          w: i.getBoundingClientRect().width,
        }))
      );
      const expected = manifest.shots.filter((s) => s.article === slug);
      r.ok(`${width}px ${slug} shows all ${expected.length} screenshots`,
        imgs.length === expected.length, `rendered ${imgs.length}`);
      r.ok(`${width}px ${slug} images all load`, imgs.every((i) => i.loaded),
        imgs.filter((i) => !i.loaded).map((i) => i.src).join());
      r.ok(`${width}px ${slug} images point at the manifest files`,
        imgs.every((i) => expected.some((e) => e.file === i.src)),
        imgs.map((i) => i.src).join());
      r.ok(`${width}px ${slug} images have real alt text`,
        imgs.every((i) => i.alt.length > 10));
      r.ok(`${width}px ${slug} does not scroll sideways`, await noHorizontalOverflow(page));
      const spill = await overflowingChildren(page, "main");
      r.ok(`${width}px ${slug} keeps everything inside the column`, spill.length === 0,
        spill.slice(0, 3).join());
    }
    if (width === 390) await screenshot(page, "illustrated-article-mobile");
    if (width === 1280) await screenshot(page, "illustrated-article-desktop");
    await ctx.close();
  }

  // …and the same article inside the panel, which is a much narrower column.
  // Every coachmark dismissed: one docked at the bottom of /dashboard/drops
  // would sit over the mobile menu and swallow the click.
  const seller = await seedFresh(prismaModule, DB, TERMS);
  await silenceGuidance(prismaModule, DB, seller.id);
  for (const viewport of ["mobile", "desktop"]) {
    const ctx = await vendorContext(browser, seller.id, viewport);
    const page = await ctx.newPage();
    await page.goto(url("/dashboard/drops"), { waitUntil: "networkidle" });
    if (viewport === "mobile") {
      await page.getByRole("button", { name: "Open menu" }).click();
      await page.getByRole("button", { name: "Help" }).last().click();
    } else {
      await page.getByRole("button", { name: "Help" }).first().click();
    }
    const panel = page.locator('[role="dialog"]');
    await panel.waitFor({ state: "visible" });
    await panel.getByRole("button", { name: /Publishing a drop/i }).first().click();
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('[role="dialog"] img')];
      return imgs.length > 0 && imgs.every((i) => i.complete);
    });
    const inPanel = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] img')].map((i) => ({
        loaded: i.naturalWidth > 0,
        w: i.getBoundingClientRect().width,
      }))
    );
    r.ok(`${viewport} panel shows the walkthrough images`, inPanel.length === 4,
      `${inPanel.length} images`);
    r.ok(`${viewport} panel images load`, inPanel.every((i) => i.loaded));
    const spill = await overflowingChildren(page, '[role="dialog"]');
    r.ok(`${viewport} panel images stay inside the panel`, spill.length === 0,
      spill.slice(0, 3).join());
    r.ok(`${viewport} panel does not scroll sideways`, await noHorizontalOverflow(page));
    await screenshot(page, `illustrated-panel-${viewport}`);
    await ctx.close();
  }
}

await browser.close();
const ok = r.report();
await db.$disconnect();
process.exit(ok ? 0 : 1);
