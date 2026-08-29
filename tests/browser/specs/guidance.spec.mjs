/**
 * Vendor guidance — the first-run and contextual journeys, in a real browser.
 *
 * Covers what pure assertions structurally cannot: that guidance appears where
 * the vendor is looking, does not cover what it is teaching, survives a reload
 * once dismissed, and works the same on a phone as on a desktop.
 *
 * Every defect this suite has caught was invisible to the unit suite and to the
 * build — a dead restart button, a one-way "Skip for now", bubbles positioned
 * from a stale measurement, guidance pointing below the fold.
 */
import prismaModule from "../../../app/generated/prisma/index.js";
import { launch, vendorContext, url, screenshot, noHorizontalOverflow, recorder, guidanceReady, focusLanded } from "../support/browser.mjs";
import { assertVerifyDatabase } from "../support/guard.mjs";
import { seedFresh, seedSelling, settleGuidance, clearGuidance, openClient, VENDOR_SLUG } from "../seed/vendor.mjs";
import { readFileSync } from "node:fs";

const DB = assertVerifyDatabase();
const TERMS = readFileSync("lib/terms.ts", "utf8").match(/TERMS_VERSION = "([^"]+)"/)[1];
const r = recorder("guidance");
const browser = await launch();
let db = await openClient(prismaModule, DB);

/** The bubble must never sit on top of the element it is teaching. */
async function checkPlacement(page, label) {
  await page.waitForTimeout(650); // let scroll-into-view settle
  const box = await page.locator('[role="note"]').boundingBox();
  const anchor = await page.evaluate(() => {
    const el = document.querySelector(".guidance-spotlight");
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  if (!box || !anchor) return;
  const vp = page.viewportSize();
  const hit =
    box.x < anchor.x + anchor.width && box.x + box.width > anchor.x &&
    box.y < anchor.y + anchor.height && box.y + box.height > anchor.y;
  r.ok(`${label}: does not cover the control it explains`, !hit);
  r.ok(`${label}: the control is on screen`,
    anchor.y >= 0 && anchor.y + anchor.height <= vp.height);
  r.ok(`${label}: the guidance is fully on screen`,
    box.y >= 0 && box.y + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width);
}

for (const viewport of ["mobile", "desktop"]) {
  r.section(`${viewport.toUpperCase()} — first run`);
  let seller = await seedFresh(prismaModule, DB, TERMS);
  const ctx = await vendorContext(browser, seller.id, viewport);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGE ERROR:", String(e).slice(0, 200)));
  const dialog = page.locator('[role="dialog"]');
  const note = page.locator('[role="note"]');

  await page.goto(url("/dashboard"), { waitUntil: "networkidle" });
  await guidanceReady(page, "dialog");
  r.ok("welcome appears for a brand-new vendor", await dialog.isVisible());

  {
    // The verify-email reminder must not outrank the activation experience.
    // Measured, not eyeballed: it is a quiet notice, so it must occupy less of
    // the screen than the checklist card that tells a vendor how to sell.
    const verify = await page.getByText("Verify your email").first().boundingBox();
    const card = await page.locator('[data-guidance-anchor="dash.checklist"]').boundingBox();
    r.ok("the verify reminder is smaller than the activation card",
      !!verify && !!card && verify.height < card.height,
      `verify=${Math.round(verify?.height ?? 0)} card=${Math.round(card?.height ?? 0)}`);
    const body = await page.locator("main").innerText();
    r.ok("the verify reminder never implies selling is blocked",
      !/verify.{0,80}(to sell|before you can|required to)/i.test(body));
    r.ok("the verify reminder keeps its action",
      await page.getByRole("button", { name: /Send verification email/i }).isVisible());
  }
  r.ok("welcome names the store", (await dialog.innerText()).includes("Sunday Bakehouse"));
  r.ok("no horizontal clipping", await noHorizontalOverflow(page));
  await screenshot(page, `${viewport}-welcome`);

  r.ok("focus lands inside the welcome", await focusLanded(page, "dialog"));
  await dialog.press("Escape");
  await page.waitForTimeout(350);
  r.ok("Escape closes the welcome", !(await dialog.isVisible()));
  await page.reload({ waitUntil: "networkidle" });
  r.ok("welcome never returns once shown", !(await dialog.isVisible()));

  await clearGuidance(prismaModule, DB, seller.id);
  await page.reload({ waitUntil: "networkidle" });
  await guidanceReady(page, "dialog");
  await page.getByRole("button", { name: "Show me around" }).click();
  await guidanceReady(page, "note");
  r.ok("tour starts at step 1", (await note.innerText()).includes("1 of 6"));
  await screenshot(page, `${viewport}-tour`);
  for (let i = 1; i < 6; i++) {
    await note.getByRole("button", { name: "Next", exact: true }).click();
    await page.waitForTimeout(260);
  }
  r.ok("tour reaches step 6", (await note.innerText()).includes("6 of 6"));
  await note.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForTimeout(400);
  r.ok("tour closes on Done", !(await note.isVisible()));
  const after = await db.vendorGuidance.findUnique({ where: { sellerId: seller.id } });
  r.ok("completion is recorded", after?.tourStatus === "completed");

  /* ---------------- contextual guidance ---------------- */
  r.section(`${viewport.toUpperCase()} — contextual`);
  await settleGuidance(prismaModule, DB, seller.id);

  await page.goto(url("/dashboard/drops"), { waitUntil: "networkidle" });
  await guidanceReady(page, "note");
  r.ok("drop-mode coachmark appears", await note.isVisible());
  const mode = await note.innerText();
  r.ok("explains both kinds", /regular drop/i.test(mode) && /live selling/i.test(mode));
  r.ok("states the choice is permanent", /can't be changed/i.test(mode));
  await checkPlacement(page, "drop mode");
  await screenshot(page, `${viewport}-coach-dropmode`);

  await note.getByRole("button", { name: "Got it" }).click();
  await page.waitForTimeout(450);
  r.ok("coachmark dismisses", !(await note.isVisible()));
  await page.reload({ waitUntil: "networkidle" });
  r.ok("dismissed coachmark stays dismissed", !(await note.isVisible()));
  const row = await db.vendorGuidance.findUnique({ where: { sellerId: seller.id } });
  r.ok("dismissal is persisted", row?.dismissedCoachmarks.includes("drops.mode"));

  await page.goto(url("/dashboard/drops/new"), { waitUntil: "networkidle" });
  await guidanceReady(page, "note");
  r.ok("order-window coachmark appears", await note.isVisible());
  r.ok("dates are taught as a sequence", /first/i.test(await note.innerText()));
  await checkPlacement(page, "order window");
  const editorTxt = await page.locator("main").innerText();
  r.ok("the editor numbers the two windows",
    editorTxt.includes("Step 1 of 2") && editorTxt.includes("Step 2 of 2"));
  await screenshot(page, `${viewport}-coach-dates`);

  /* ---------------- publish, QR, celebration ---------------- */
  const { drop } = await seedSelling(prismaModule, DB);
  seller = await db.seller.findFirstOrThrow({ where: { slug: VENDOR_SLUG } });
  await settleGuidance(prismaModule, DB, seller.id);
  await db.drop.update({ where: { id: drop.id }, data: { status: "draft" } });
  await page.goto(url(`/dashboard/drops/${drop.id}`), { waitUntil: "networkidle" });
  await guidanceReady(page, "note");
  r.ok("publish coachmark appears for a charge-ready vendor", await note.isVisible());
  r.ok("publish explains the schedule", /order window/i.test(await note.innerText()));
  await checkPlacement(page, "publish");
  r.ok("a DRAFT does not claim ordering closed",
    !/Ordering closed/i.test(await page.locator("main").innerText()));
  r.ok("a draft says it is unpublished",
    /Not published yet/i.test(await page.locator("main").innerText()));
  await screenshot(page, `${viewport}-coach-publish`);

  await note.getByRole("button", { name: "Got it" }).click();
  await page.waitForTimeout(450);
  r.ok("QR coachmark follows", await note.isVisible());
  const qr = await note.innerText();
  r.ok("QR is scoped to one drop", /every drop gets its own/i.test(qr));
  r.ok("no walk-up mention while the flag is off", !/walk[- ]up/i.test(qr));
  await checkPlacement(page, "QR");
  await note.getByRole("button", { name: "Got it" }).click();
  await page.waitForTimeout(300);

  await db.drop.update({ where: { id: drop.id }, data: { status: "live" } });
  await page.goto(url("/dashboard"), { waitUntil: "networkidle" });
  r.ok("first-publish celebration shows",
    (await page.locator("main").innerText()).includes("Your first drop is live"));

  await db.order.create({ data: {
    sellerId: seller.id, dropId: drop.id, buyerName: "Ada", buyerEmail: "ada@example.com",
    status: "new", paymentStatus: "paid", totalCents: 900, feeCents: 18 } });
  await db.vendorGuidance.update({ where: { sellerId: seller.id }, data: { sharedAt: new Date() } });
  await page.goto(url("/dashboard"), { waitUntil: "networkidle" });
  const overview = await page.locator("main").innerText();
  r.ok("first order is celebrated", /You got your first order/i.test(overview));
  r.ok("the celebration keeps the useful action", /View order/i.test(overview));
  r.ok("the celebration REPLACES the next-step card, not duplicates it",
    !/order[s]? to prepare/i.test(overview), overview.match(/NEXT STEP[\s\S]{0,80}/)?.[0] ?? "");
  r.ok("no points, badges or streaks", !/point|badge|streak/i.test(overview));
  r.ok("no clipping on the overview", await noHorizontalOverflow(page));
  await screenshot(page, `${viewport}-first-order`);

  await ctx.close();
}

/* ---------------- accessibility ---------------- */
r.section("ACCESSIBILITY");
{
  const seller = await seedFresh(prismaModule, DB, TERMS);
  await settleGuidance(prismaModule, DB, seller.id);
  const ctx = await vendorContext(browser, seller.id, "desktop", { reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(url("/dashboard/drops"), { waitUntil: "networkidle" });
  await guidanceReady(page, "note");
  r.ok("animation is off under reduced-motion",
    (await page.evaluate(() => {
      const el = document.querySelector('[role="note"]');
      return el ? getComputedStyle(el).animationName : "missing";
    })) === "none");
  r.ok("focus moves to the coachmark", await focusLanded(page, "note"));
  r.ok("a coachmark is not modal",
    await page.evaluate(() => !document.querySelector('[role="note"][aria-modal]')));
  await ctx.close();
}

await browser.close();
const okAll = r.report();
await db.$disconnect();
process.exit(okAll ? 0 : 1);
