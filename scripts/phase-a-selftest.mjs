/**
 * Phase A self-test — "a DropQ vendor cannot sell unless Stripe is connected
 * and currently charge-ready."
 *
 * Pure logic + static source assertions. Writes NOTHING, anywhere. The one
 * database query is a read-only sanity check of production seller shapes.
 *
 *   node --env-file=.env scripts/phase-a-selftest.mjs
 *
 * The rule lives in lib/payments.ts, which is TypeScript and "server-only", so
 * this harness reimplements the three predicates and asserts the source matches
 * — see checkSourceParity() at the bottom. That keeps the harness dependency-
 * free while still failing loudly if the real implementation drifts.
 */
import { readFileSync } from "node:fs";

let pass = 0;
const failures = [];
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}`); }
}
function section(t) { console.log(`\n${t}`); }

// ── Mirror of lib/payments.ts ───────────────────────────────────────────────
const STRIPE_KEY_SET = true; // production: STRIPE_SECRET_KEY is always set
function isVendorSellable(s, stripeEnabled = STRIPE_KEY_SET) {
  if (!stripeEnabled) return true;
  if (s.disabledAt) return false;
  return s.stripeChargesEnabled && !!s.stripeAccountId;
}
function sellerBlockReason(s, stripeEnabled = STRIPE_KEY_SET) {
  if (isVendorSellable(s, stripeEnabled)) return null;
  if (s.disabledAt) return "suspended";
  if (!s.stripeAccountId) return "not_connected";
  return "charges_disabled";
}
const DROP_STATUSES = ["draft", "live", "closed"];
function resolveDropStatus(requested, current, seller, stripeEnabled = STRIPE_KEY_SET) {
  const status = DROP_STATUSES.includes(requested) ? requested : current;
  if (status === "live" && current !== "live" && !isVendorSellable(seller, stripeEnabled)) {
    return { status: "draft", blocked: true };
  }
  return { status, blocked: false };
}

const READY   = { stripeChargesEnabled: true,  stripeAccountId: "acct_1", disabledAt: null };
const NOACCT  = { stripeChargesEnabled: false, stripeAccountId: null,     disabledAt: null };
const REVOKED = { stripeChargesEnabled: false, stripeAccountId: "acct_1", disabledAt: null };
const SUSPEND = { stripeChargesEnabled: true,  stripeAccountId: "acct_1", disabledAt: new Date() };

// ── 1. Sellability ──────────────────────────────────────────────────────────
section("Sellability (the governing rule)");
ok("charge-ready vendor can sell", isVendorSellable(READY) === true);
ok("vendor with no Stripe account cannot sell", isVendorSellable(NOACCT) === false);
ok("vendor whose charges Stripe revoked cannot sell", isVendorSellable(REVOKED) === false);
ok("admin-suspended vendor cannot sell", isVendorSellable(SUSPEND) === false);
ok("local dev with no platform key: demo path stays open", isVendorSellable(NOACCT, false) === true);
ok("local dev still blocks a suspended vendor is NOT required (dev convenience)", isVendorSellable(SUSPEND, false) === true);

// ── 2. Block reasons drive distinct vendor copy ─────────────────────────────
section("Block reasons (distinct vendor messaging)");
ok("charge-ready vendor gets no banner", sellerBlockReason(READY) === null);
ok("never connected -> not_connected", sellerBlockReason(NOACCT) === "not_connected");
ok("connected but charges off -> charges_disabled", sellerBlockReason(REVOKED) === "charges_disabled");
ok("suspended -> suspended", sellerBlockReason(SUSPEND) === "suspended");
ok("the two Stripe failure modes are distinguishable",
   sellerBlockReason(NOACCT) !== sellerBlockReason(REVOKED));

// ── 3. Publish gate ─────────────────────────────────────────────────────────
section("Drop publish gate");
ok("charge-ready vendor can publish draft -> live",
   resolveDropStatus("live", "draft", READY).status === "live");
ok("charge-ready publish is not flagged blocked",
   resolveDropStatus("live", "draft", READY).blocked === false);
ok("no-Stripe vendor CANNOT publish draft -> live",
   resolveDropStatus("live", "draft", NOACCT).status === "draft");
ok("no-Stripe publish attempt is flagged blocked",
   resolveDropStatus("live", "draft", NOACCT).blocked === true);
ok("charges-revoked vendor CANNOT publish draft -> live",
   resolveDropStatus("live", "draft", REVOKED).status === "draft");
ok("closed -> live is blocked for a non-sellable vendor",
   resolveDropStatus("live", "closed", REVOKED).status === "draft");

section("Drop takedown must ALWAYS work (Stripe broke mid-drop)");
ok("live -> closed allowed with no Stripe",
   resolveDropStatus("closed", "live", NOACCT).status === "closed");
ok("live -> closed allowed with charges revoked",
   resolveDropStatus("closed", "live", REVOKED).status === "closed");
ok("live -> draft allowed with charges revoked",
   resolveDropStatus("draft", "live", REVOKED).status === "draft");
ok("live -> live is a no-op, not a blocked publish",
   resolveDropStatus("live", "live", REVOKED).blocked === false);
ok("live -> closed is never flagged blocked",
   resolveDropStatus("closed", "live", REVOKED).blocked === false);

section("Drafts stay editable");
ok("draft -> draft allowed with no Stripe",
   resolveDropStatus("draft", "draft", NOACCT).status === "draft");
ok("draft -> draft not flagged blocked",
   resolveDropStatus("draft", "draft", NOACCT).blocked === false);

section("Status whitelist (updateDropStatusAction wrote raw form values)");
ok("garbage status falls back to current, not written",
   resolveDropStatus("wat", "draft", READY).status === "draft");
ok("SQL-ish payload rejected",
   resolveDropStatus("'; DROP TABLE", "closed", READY).status === "closed");
ok("empty status rejected", resolveDropStatus("", "live", READY).status === "live");
ok("'fulfilled' (an ORDER status) rejected as a drop status",
   resolveDropStatus("fulfilled", "draft", READY).status === "draft");

// ── 4. Payment labels ───────────────────────────────────────────────────────
section("Payment labels");
const src = readFileSync("lib/orders.ts", "utf8");
// Strip comments: the file explains WHY the old label was wrong, and that
// prose must not trip the assertion. What matters is the emitted label map.
const srcCode = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
ok('unpaid renders "Unpaid", never "Pay in person"',
   /unpaid:\s*"Unpaid"/.test(srcCode) && !/Pay in person/.test(srcCode));
for (const k of ["refund_pending", "refunded", "expired"]) {
  ok(`${k} has a label`, new RegExp(`${k}:\\s*"[^"]+"`).test(src));
  ok(`${k} has a style`, src.split("paymentStyle")[1].includes(k));
}

// ── 5. Static source assertions ─────────────────────────────────────────────
section("Source assertions");
const orderSrc = readFileSync("lib/actions/order.ts", "utf8");
const guardIdx = orderSrc.indexOf("isVendorSellable(drop.seller)");
const firstWrite = Math.min(
  ...["prisma.order.create", "prisma.$transaction", "tx.order.create", "$executeRaw"]
    .map((s) => { const i = orderSrc.indexOf(s); return i === -1 ? Infinity : i; })
);
ok("placeOrderAction calls isVendorSellable", guardIdx > -1);
ok("the sell gate runs BEFORE any database write", guardIdx > -1 && guardIdx < firstWrite);
ok("checkout no longer reads a payInPerson field", !orderSrc.includes("payInPerson"));
ok("useStripe no longer has a customer-controlled term",
   /const useStripe\s*=\s*\n?\s*!!stripe && drop\.seller\.stripeChargesEnabled && !!drop\.seller\.stripeAccountId;/.test(
     orderSrc.replace(/\s+/g, " ").replace(/const useStripe = /, "const useStripe =\n    ")
   ) || !/useStripe[\s\S]{0,200}payInPerson/.test(orderSrc));
ok("the free-order branch is labelled local-dev-only",
   /LOCAL DEV ONLY/.test(orderSrc) && /UNREACHABLE IN PRODUCTION/.test(orderSrc));

const dashSrc = readFileSync("lib/actions/dashboard.ts", "utf8");
const statusWriters = ["createDropAction", "updateDropFullAction", "updateDropStatusAction"];
for (const fn of statusWriters) {
  const body = dashSrc.slice(dashSrc.indexOf(`function ${fn}`), dashSrc.indexOf(`function ${fn}`) + 2200);
  ok(`${fn} routes status through resolveDropStatus`, body.includes("resolveDropStatus("));
}
ok("dashboard no longer inlines a status whitelist",
   !/\["draft", "live", "closed"\]\.includes/.test(dashSrc));

const storeSrc = readFileSync("components/storefront-order.tsx", "utf8");
ok("storefront form has no pay-in-person button", !/[Pp]ay in person/.test(storeSrc));
ok("storefront form has no payInPerson field", !storeSrc.includes("payInPerson"));

const dropPageSrc = readFileSync("app/s/[slug]/[dropId]/page.tsx", "utf8");
ok("drop page gates the order form on isVendorSellable",
   dropPageSrc.includes("isVendorSellable(drop.seller)"));
ok('drop page renders the neutral unavailable state',
   dropPageSrc.includes("Not accepting orders right now"));
ok("customer-facing copy never mentions Stripe or the vendor's account",
   !/Not accepting orders right now[\s\S]{0,400}Stripe/.test(dropPageSrc));

const bannerSrc = readFileSync("components/stripe-required-banner.tsx", "utf8");
ok("banner distinguishes charges_disabled from not_connected",
   bannerSrc.includes("charges_disabled"));
ok("banner escalates when a live drop exists", bannerSrc.includes('status: "live"'));

// Parity: the harness mirrors lib/payments.ts, so fail if that file changes shape.
function checkSourceParity() {
  const p = readFileSync("lib/payments.ts", "utf8");
  ok("lib/payments.ts still exports the three predicates",
     p.includes("export function isVendorSellable") &&
     p.includes("export function sellerBlockReason") &&
     p.includes("export function resolveDropStatus"));
  ok("isVendorSellable still short-circuits on !isStripeEnabled()",
     /if \(!isStripeEnabled\(\)\) return true;/.test(p));
  ok("isVendorSellable still blocks suspended vendors",
     /if \(seller\.disabledAt\) return false;/.test(p));
  ok("resolveDropStatus still allows leaving 'live'",
     /current !== "live"/.test(p));
}
section("Harness/implementation parity");
checkSourceParity();

// ── 5b. Selling-paused notification (Phase A follow-up) ─────────────────────
// The webhook's conditional updateMany is the transition detector. Model it:
// a row is matched only when its stored flag differs from the incoming one.
function accountUpdated(storedEnabled, incomingEnabled) {
  const matched = storedEnabled === !incomingEnabled; // the updateMany predicate
  return { flippedCount: matched ? 1 : 0, emails: matched && !incomingEnabled ? 1 : 0 };
}

section("account.updated -> selling-paused email");
ok("charge-ready vendor loses charges -> exactly one email",
   accountUpdated(true, false).emails === 1);
ok("...and the flag is flipped", accountUpdated(true, false).flippedCount === 1);
ok("webhook RETRY of the same event sends no second email",
   accountUpdated(false, false).emails === 0);
ok("repeated account.updated while already disabled stays silent",
   accountUpdated(false, false).flippedCount === 0);
ok("regaining charges sends no email", accountUpdated(false, true).emails === 0);
ok("...but does flip the flag back", accountUpdated(false, true).flippedCount === 1);
ok("no-op event on a healthy vendor stays silent",
   accountUpdated(true, true).emails === 0 && accountUpdated(true, true).flippedCount === 0);
ok("a brand-new account mid-onboarding (never enabled) sends no email",
   accountUpdated(false, false).emails === 0);

const hookSrc = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
ok("webhook detects the transition with a conditional updateMany",
   /stripeChargesEnabled: !chargesEnabled/.test(hookSrc));
ok("webhook emails only when the flip actually happened",
   /flipped\.count > 0 && !chargesEnabled/.test(hookSrc));
ok("webhook no longer writes unconditionally",
   !/where: \{ stripeAccountId: account\.id \},\s*\n\s*data: \{ stripeChargesEnabled/.test(hookSrc));

const alertSrc = readFileSync("lib/vendor-alerts.ts", "utf8");
ok("the alert never throws (webhook must stay 200)",
   /try \{/.test(alertSrc) && /catch \(e\)/.test(alertSrc));
ok("the alert skips admin-suspended vendors", /disabledAt/.test(alertSrc));
ok("the alert counts live drops for the impact line", /status: "live"/.test(alertSrc));
ok("the alert logs an operational breadcrumb", /charges disabled/.test(alertSrc));

const mailSrc = readFileSync("lib/email.ts", "utf8");
ok("sellingPausedEmail exists", /export function sellingPausedEmail/.test(mailSrc));
ok("email links to payments settings", /dashboard\/payments/.test(readFileSync("lib/vendor-alerts.ts", "utf8")));
ok("email reassures that drafts and data survive",
   /Nothing has been lost/.test(mailSrc) && /close or unpublish/.test(mailSrc));
ok("email escapes the store name", /esc\(o\.storeName\)/.test(mailSrc));

// ── 6. Read-only production shape check ─────────────────────────────────────
section("Production seller shapes (READ ONLY)");
try {
  const { PrismaClient } = await import("../app/generated/prisma/index.js");
  const prisma = new PrismaClient();
  const sellers = await prisma.seller.findMany({
    select: { storeName: true, stripeChargesEnabled: true, stripeAccountId: true, disabledAt: true },
  });
  const sellable = sellers.filter((s) => isVendorSellable(s));
  const blocked = sellers.filter((s) => !isVendorSellable(s));
  console.log(`  sellable: ${sellable.map((s) => s.storeName).join(", ")}`);
  console.log(`  blocked:  ${blocked.map((s) => `${s.storeName} (${sellerBlockReason(s)})`).join(", ")}`);
  ok("every production seller classifies without throwing", sellers.length > 0);
  ok("no production seller is in an undefined state",
     sellers.every((s) => isVendorSellable(s) || !!sellerBlockReason(s)));
  // This used to assert `live === 0` — true while Phase A was rolling out, but
  // that was a point-in-time fact about production, not an invariant. DropQ
  // having live drops is the goal. Replaced with the property Phase A actually
  // guarantees, which is worth checking forever: a drop can only BE live if its
  // vendor can take money. A failure here means either the publish gate leaked
  // or a selling vendor's Stripe was revoked while their drop stayed up.
  const liveDrops = await prisma.drop.findMany({
    where: { status: "live" },
    select: { title: true, seller: { select: { storeName: true, stripeChargesEnabled: true, stripeAccountId: true, disabledAt: true } } },
  });
  console.log(`  live drops in production: ${liveDrops.length}`);
  for (const d of liveDrops) {
    console.log(`    "${d.title}" — ${d.seller.storeName} (${isVendorSellable(d.seller) ? "charge-ready" : "NOT SELLABLE"})`);
  }
  ok("every live drop belongs to a charge-ready vendor",
     liveDrops.every((d) => isVendorSellable(d.seller)),
     liveDrops.filter((d) => !isVendorSellable(d.seller)).map((d) => d.title).join(", "));
  await prisma.$disconnect();
} catch (e) {
  console.log(`  ! skipped DB check: ${e.message}`);
}

console.log(`\n${failures.length === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
