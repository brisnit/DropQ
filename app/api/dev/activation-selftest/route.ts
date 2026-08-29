import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  activationState,
  stripeActivationState,
  stripeBlocksSelling,
  activationFacts,
  activationCardMode,
  showsGenericNextStep,
  attentionState,
  isOutreachable,
  publishGate,
  attentionRank,
  loadVendorActivationRows,
  type ActivationSeller,
  type ActivationFacts,
} from "@/lib/activation";

/**
 * Development-only self-test for the vendor activation derivation (Phase V.0).
 *
 * Exercises the REAL lib/activation.ts rather than a mirror of it, following the
 * messaging-selftest precedent — but unlike that route this one **writes
 * nothing**: the fixtures are plain objects, and the only database access is a
 * read-only pass over the production sellers to confirm every one of them
 * derives a sane state.
 *
 * Hard 404 outside development.
 *
 *   curl localhost:3000/api/dev/activation-selftest
 */

type Result = { name: string; pass: boolean; detail?: string };

const READY: ActivationSeller = {
  email: "v@example.com",
  slug: "v",
  emailVerified: true,
  disabledAt: null,
  stripeAccountId: "acct_1",
  stripeChargesEnabled: true,
  stripeChargesEnabledAt: new Date("2026-01-01"),
};
const NOT_STARTED: ActivationSeller = {
  ...READY,
  stripeAccountId: null,
  stripeChargesEnabled: false,
  stripeChargesEnabledAt: null,
};
const INCOMPLETE: ActivationSeller = {
  ...READY,
  stripeChargesEnabled: false,
  stripeChargesEnabledAt: null,
};
const RESTRICTED: ActivationSeller = { ...READY, stripeChargesEnabled: false };
const SUSPENDED: ActivationSeller = { ...READY, disabledAt: new Date() };
/** Charge-ready before V.1 started recording the timestamp. */
const LEGACY_READY: ActivationSeller = { ...READY, stripeChargesEnabledAt: null };

const NOTHING: ActivationFacts = { dropsWithProducts: 0, liveDrops: 0, paidOrders: 0, hasShared: false };
const HAS_DROP: ActivationFacts = { dropsWithProducts: 1, liveDrops: 0, paidOrders: 0, hasShared: false };
const PUBLISHED: ActivationFacts = { dropsWithProducts: 1, liveDrops: 1, paidOrders: 0, hasShared: false };
const SOLD: ActivationFacts = { dropsWithProducts: 1, liveDrops: 1, paidOrders: 3, hasShared: false };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results: Result[] = [];
  const live: Record<string, string> = {};
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ---------------------------- Stripe states --------------------------- */
  check("charge-ready", stripeActivationState(READY) === "charge_ready");
  check("no account -> not_started", stripeActivationState(NOT_STARTED) === "not_started");
  check("account, never ready -> incomplete/unknown",
    stripeActivationState(INCOMPLETE) === "unknown");
  check("was ready, now off -> restricted", stripeActivationState(RESTRICTED) === "restricted");
  check("admin-suspended wins over everything",
    stripeActivationState(SUSPENDED) === "suspended");
  check("a completed sale proves prior readiness -> restricted",
    stripeActivationState(INCOMPLETE, true) === "restricted");
  check("legacy charge-ready with no timestamp still reads charge_ready",
    stripeActivationState(LEGACY_READY) === "charge_ready");
  check("only charge_ready permits selling",
    (["not_started", "incomplete", "restricted", "unknown", "suspended"] as const)
      .every(stripeBlocksSelling) && !stripeBlocksSelling("charge_ready"));

  /* ------------------------------ Ready to Sell -------------------------- */
  check("Ready to Sell is Stripe alone — no drop, no product, still ready",
    activationState(READY, NOTHING).readyToSell === true);
  check("a vendor with drops but no Stripe is NOT ready",
    activationState(NOT_STARTED, PUBLISHED).readyToSell === false);
  check("a suspended vendor is never ready",
    activationState(SUSPENDED, SOLD).readyToSell === false);

  /* ------------------------------- Milestones ---------------------------- */
  {
    // G.2: email is no longer a milestone, so only "account" is done here.
    const s = activationState(NOT_STARTED, NOTHING);
    check("vendor with no Stripe and no drop: 1 of 5",
      s.completed === 1 && s.total === 5, `completed=${s.completed}`);
    check("only Stripe is marked required to sell",
      s.milestones.filter((m) => m.requiredToSell).map((m) => m.key).join() === "stripe");
    check("account milestone is always done",
      s.milestones.find((m) => m.key === "account")!.done);
  }
  {
    // Email verification no longer moves the number in either direction.
    const verified = activationState({ ...NOT_STARTED, emailVerified: true }, NOTHING);
    const unverified = activationState({ ...NOT_STARTED, emailVerified: false }, NOTHING);
    check("email verification no longer affects the count",
      verified.completed === unverified.completed && verified.completed === 1);
    check("no milestone is keyed 'email' any more",
      !verified.milestones.some((m) => (m.key as string) === "email"));
    check("the five milestones are account/stripe/drop/publish/share",
      verified.milestones.map((m) => m.key).join() === "account,stripe,drop,publish,share",
      verified.milestones.map((m) => m.key).join());
  }
  /* ---------------------------- Share milestone -------------------------- */
  {
    const shared = activationState(READY, { ...PUBLISHED, hasShared: true });
    check("an explicit share completes 'share'",
      shared.milestones.find((m) => m.key === "share")!.done);
    check("no share and no sale leaves 'share' outstanding",
      !activationState(READY, PUBLISHED).milestones.find((m) => m.key === "share")!.done);
    check("a paid order counts as proof of sharing",
      activationState(READY, SOLD).milestones.find((m) => m.key === "share")!.done);
    check("a fully activated, shared, selling vendor is 5 of 5",
      activationState(READY, { ...SOLD, hasShared: true }).completed === 5);
  }
  check("a live drop completes 'publish'",
    activationState(READY, PUBLISHED).milestones.find((m) => m.key === "publish")!.done);
  check("a paid order completes 'publish' even with no live drop now",
    activationState(READY, { dropsWithProducts: 1, liveDrops: 0, paidOrders: 1, hasShared: false })
      .milestones.find((m) => m.key === "publish")!.done);
  check("a drop with no products does not complete 'build a drop'",
    !activationState(READY, NOTHING).milestones.find((m) => m.key === "drop")!.done);

  /* --------------------------------- Stage ------------------------------- */
  check("activating while anything is outstanding",
    activationState(NOT_STARTED, HAS_DROP).stage === "activating");
  check("ready_no_sale when all 5 done and nothing sold",
    activationState(READY, PUBLISHED).stage === "ready_no_sale");
  check("complete once a paid order exists",
    activationState(READY, SOLD).stage === "complete");
  check("a sale completes activation even if email is unverified",
    activationState({ ...READY, emailVerified: false }, SOLD).stage === "complete");

  /* ------------------------------ Next action ---------------------------- */
  {
    const n = activationState(NOT_STARTED, HAS_DROP).nextAction!;
    check("drop built + no Stripe -> Grandies case",
      n.key === "stripe" && n.reason === "Your drop is ready. Connect Stripe to publish it.",
      n.reason);
  }
  {
    const n = activationState(NOT_STARTED, NOTHING).nextAction!;
    check("no drop + no Stripe -> generic Stripe ask",
      n.key === "stripe" && n.cta === "Connect Stripe" && !n.reason.includes("Your drop"));
  }
  check("restricted vendor is told Stripe turned payments off",
    activationState(RESTRICTED, PUBLISHED).nextAction!.reason.startsWith("Stripe turned off"));
  check("incomplete setup says 'Finish Stripe setup'",
    activationState(INCOMPLETE, NOTHING).nextAction!.cta === "Finish Stripe setup");
  check("ready + no drop -> build a drop",
    activationState(READY, NOTHING).nextAction!.key === "drop");
  check("ready + drop, nothing live -> publish",
    activationState(READY, HAS_DROP).nextAction!.key === "publish");
  check("published but unsold -> share the link",
    activationState(READY, PUBLISHED).nextAction!.key === "share");
  check("fully activated, shared and selling -> no next action",
    activationState(READY, { ...SOLD, hasShared: true }).nextAction === null);
  check("a selling vendor with an unverified email gets NO next action",
    // G.2: the VerifyBanner owns email verification. This module no longer nags.
    activationState({ ...READY, emailVerified: false }, { ...SOLD, hasShared: true })
      .nextAction === null);
  check("share is the next action once publishing is done",
    activationState(READY, PUBLISHED).nextAction!.key === "share");
  check("suspended vendor gets no self-service next action",
    activationState(SUSPENDED, NOTHING).nextAction === null);

  /* --------------------------- Demo-store exclusion ---------------------- */
  check("the marketing showcase is excluded by slug",
    activationState({ ...NOT_STARTED, slug: "marble-crumb" }, HAS_DROP).applicable === false);
  check("the marketing showcase is excluded by email",
    activationState({ ...NOT_STARTED, email: "showcase@dropq.example" }, HAS_DROP)
      .applicable === false);
  check("a real vendor is applicable", activationState(NOT_STARTED, HAS_DROP).applicable === true);

  /* ------------- V.1 activation-timestamp transition semantics ----------- */
  // Proven against the REAL Seller table, inside a transaction that always
  // rolls back, so the exact predicates shipped in the webhook are exercised
  // rather than a model of them.
  {
    const ROLLBACK = "__rollback__";
    // Stamp exactly as app/api/stripe/webhook/route.ts does.
    const applyTransition = async (
      tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
      id: string,
      chargesEnabled: boolean
    ) => {
      const flipped = await tx.seller.updateMany({
        where: { id, stripeChargesEnabled: !chargesEnabled },
        data: { stripeChargesEnabled: chargesEnabled },
      });
      if (flipped.count > 0 && chargesEnabled) {
        await tx.seller.updateMany({
          where: { id, stripeChargesEnabledAt: null },
          data: { stripeChargesEnabledAt: new Date() },
        });
      }
      return flipped.count;
    };

    const victim = await prisma.seller.findFirst({ select: { id: true } });
    let t: {
      afterFirst: Date | null;
      afterOff: Date | null;
      afterSecond: Date | null;
      noopFlips: number;
      firstFlips: number;
    } | null = null;

    try {
      await prisma.$transaction(async (tx) => {
        // Start from a clean "never activated" state.
        await tx.seller.update({
          where: { id: victim!.id },
          data: { stripeChargesEnabled: false, stripeChargesEnabledAt: null },
        });

        const firstFlips = await applyTransition(tx, victim!.id, true);
        const afterFirst = (await tx.seller.findUnique({
          where: { id: victim!.id }, select: { stripeChargesEnabledAt: true },
        }))!.stripeChargesEnabledAt;

        // true -> true must be a no-op.
        const noopFlips = await applyTransition(tx, victim!.id, true);

        // true -> false must PRESERVE the timestamp.
        await applyTransition(tx, victim!.id, false);
        const afterOff = (await tx.seller.findUnique({
          where: { id: victim!.id }, select: { stripeChargesEnabledAt: true },
        }))!.stripeChargesEnabledAt;

        // Re-activation must NOT overwrite it.
        await new Promise((r) => setTimeout(r, 5));
        await applyTransition(tx, victim!.id, true);
        const afterSecond = (await tx.seller.findUnique({
          where: { id: victim!.id }, select: { stripeChargesEnabledAt: true },
        }))!.stripeChargesEnabledAt;

        t = { afterFirst, afterOff, afterSecond, noopFlips, firstFlips };
        throw new Error(ROLLBACK);
      });
    } catch (e) {
      if (!(e instanceof Error && e.message === ROLLBACK)) throw e;
    }

    const r = t as unknown as {
      afterFirst: Date | null; afterOff: Date | null; afterSecond: Date | null;
      noopFlips: number; firstFlips: number;
    };
    check("V.1 first false->true flips the row", r.firstFlips === 1);
    check("V.1 first false->true SETS the timestamp", r.afterFirst !== null);
    check("V.1 true->true is a no-op (0 rows flipped)", r.noopFlips === 0);
    check("V.1 true->false PRESERVES the timestamp",
      r.afterOff !== null && r.afterOff.getTime() === r.afterFirst!.getTime());
    check("V.1 later false->true does NOT overwrite the timestamp",
      r.afterSecond !== null && r.afterSecond.getTime() === r.afterFirst!.getTime(),
      `first=${r.afterFirst?.toISOString()} second=${r.afterSecond?.toISOString()}`);

    const stillNull = await prisma.seller.count({ where: { stripeChargesEnabledAt: null } });
    const total = await prisma.seller.count();
    check("V.1 transition test wrote nothing to production",
      stillNull === total, `${stillNull}/${total} still NULL`);
  }

  /* -------- Legacy vendors: NULL timestamp must not misclassify them ------ */
  check("legacy charge-ready + NULL timestamp is charge_ready, not not_started",
    stripeActivationState(LEGACY_READY) === "charge_ready");
  check("legacy charge-ready + NULL timestamp is Ready to Sell",
    activationState(LEGACY_READY, NOTHING).readyToSell === true);
  check("null stripeAccountId is the ONLY route to not_started",
    stripeActivationState({ ...LEGACY_READY, stripeChargesEnabled: false }) !== "not_started" &&
    stripeActivationState(NOT_STARTED) === "not_started");
  check("legacy vendor with an account but no timestamp reads unknown, not not_started",
    stripeActivationState({ ...LEGACY_READY, stripeChargesEnabled: false }) === "unknown");
  check("an unknown-state vendor is never told 'Connect Stripe' from scratch",
    activationState({ ...LEGACY_READY, stripeChargesEnabled: false }, NOTHING)
      .nextAction!.cta === "Finish Stripe setup");
  check("current sellability never depends on the timestamp",
    activationState(LEGACY_READY, NOTHING).readyToSell ===
      activationState(READY, NOTHING).readyToSell);

  /* ----------------- V.2 dashboard card modes (the 9 scenarios) ---------- */
  const mode = (sel: ActivationSeller, f: ActivationFacts) =>
    activationCardMode(activationState(sel, f));
  const generic = (sel: ActivationSeller, f: ActivationFacts) =>
    showsGenericNextStep(activationState(sel, f));

  check("V.2 not started, no drop -> full checklist", mode(NOT_STARTED, NOTHING) === "full");
  check("V.2 not started, draft drop -> full checklist", mode(NOT_STARTED, HAS_DROP) === "full");
  check("V.2 charge-ready, no drop -> compact", mode(READY, NOTHING) === "compact");
  check("V.2 charge-ready, draft drop -> compact", mode(READY, HAS_DROP) === "compact");
  check("V.2 published, unsold -> compact", mode(READY, PUBLISHED) === "compact");
  check("V.2 first paid order -> card disappears", mode(READY, SOLD) === "hidden");
  check("V.2 restricted vendor -> paused, NOT a fresh checklist",
    mode(RESTRICTED, PUBLISHED) === "paused");
  check("V.2 legacy/unknown Stripe -> full checklist", mode(INCOMPLETE, NOTHING) === "full");
  check("V.2 demo store -> hidden regardless of state",
    mode({ ...NOT_STARTED, slug: "marble-crumb" }, HAS_DROP) === "hidden" &&
    mode({ ...READY, slug: "marble-crumb" }, SOLD) === "hidden");

  // The whole point of V.2: a vendor who sold, then got restricted, must
  // reappear — and must NOT be walked through onboarding again.
  check("V.2 restricted AFTER selling -> reappears as paused, not hidden",
    mode(RESTRICTED, SOLD) === "paused");
  check("V.2 a restricted vendor is never shown the 5-step checklist",
    mode(RESTRICTED, SOLD) !== "full" && mode(RESTRICTED, PUBLISHED) !== "full");

  /* -------- No contradictory guidance (the Grandies bug this fixes) ------- */
  check("V.2 generic Next-step card is suppressed whenever activation shows",
    !generic(NOT_STARTED, HAS_DROP) && !generic(READY, PUBLISHED) &&
    !generic(RESTRICTED, SOLD) && !generic(INCOMPLETE, NOTHING));
  check("V.2 generic Next-step card returns once the vendor is selling",
    generic(READY, SOLD) === true);
  check("V.2 demo store keeps the normal dashboard",
    generic({ ...NOT_STARTED, slug: "marble-crumb" }, HAS_DROP) === true);
  {
    // Grandies: draft drop, no Stripe. Must be told to connect Stripe, and must
    // NOT be told to publish.
    const st = activationState(NOT_STARTED, HAS_DROP);
    check("V.2 Grandies-like state is told to connect Stripe",
      st.nextAction!.key === "stripe" && st.nextAction!.cta === "Connect Stripe");
    check("V.2 Grandies-like state is NEVER told to publish",
      st.nextAction!.key !== "publish" &&
      !/publish it to start taking orders/i.test(st.nextAction!.reason) &&
      showsGenericNextStep(st) === false);
    check("V.2 Grandies-like CTA points at the existing Stripe flow",
      st.nextAction!.href === "/dashboard/payments");
  }
  check("V.2 every Stripe next-action routes to the existing payments page",
    [activationState(NOT_STARTED, NOTHING), activationState(INCOMPLETE, NOTHING),
     activationState(RESTRICTED, PUBLISHED)]
      .every((x) => x.nextAction!.href === "/dashboard/payments"));
  check("V.2 an existing-account vendor is never told to connect from scratch",
    activationState(INCOMPLETE, NOTHING).nextAction!.cta !== "Connect Stripe" &&
    activationState(RESTRICTED, NOTHING).nextAction!.cta !== "Connect Stripe");

  /* ------ V.2 does not change enforcement: still derived, never gating ---- */
  check("V.2 card mode never affects readyToSell",
    activationState(READY, SOLD).readyToSell === true &&
    activationState(NOT_STARTED, SOLD).readyToSell === false);

  /* ------------------- V.Admin attention + exclusions --------------------- */
  const att = (sel: ActivationSeller, f: ActivationFacts) =>
    attentionState(activationState(sel, f), f);

  check("V.Admin restricted -> selling_paused (highest urgency)",
    att(RESTRICTED, PUBLISHED) === "selling_paused");
  check("V.Admin restricted outranks everything, even with sales",
    att(RESTRICTED, SOLD) === "selling_paused");
  check("V.Admin built a drop + no Stripe -> needs_help (the Grandies case)",
    att(NOT_STARTED, HAS_DROP) === "needs_help");
  check("V.Admin no drop + no Stripe -> not flagged (no intent demonstrated)",
    att(NOT_STARTED, NOTHING) === "none");
  check("V.Admin charge-ready is never flagged",
    att(READY, NOTHING) === "none" && att(READY, HAS_DROP) === "none" &&
    att(READY, SOLD) === "none");
  check("V.Admin legacy/unknown Stripe with a drop -> needs_help",
    att(INCOMPLETE, HAS_DROP) === "needs_help");
  check("V.Admin needs_help has NO time threshold — a brand-new vendor qualifies",
    att(NOT_STARTED, HAS_DROP) === "needs_help");
  check("V.Admin ordering: paused before needs_help before the rest",
    attentionRank("selling_paused") < attentionRank("needs_help") &&
    attentionRank("needs_help") < attentionRank("none"));

  const demoSeller = { ...NOT_STARTED, slug: "marble-crumb" };
  check("V.Admin demo store is NOT outreachable",
    isOutreachable({ isAdmin: false }, activationState(demoSeller, HAS_DROP)) === false);
  check("V.Admin internal (isAdmin) account is NOT outreachable",
    isOutreachable({ isAdmin: true }, activationState(NOT_STARTED, HAS_DROP)) === false);
  check("V.Admin a normal vendor IS outreachable",
    isOutreachable({ isAdmin: false }, activationState(NOT_STARTED, HAS_DROP)) === true);
  check("V.Admin a demo store stays excluded even if it isn't internal",
    isOutreachable({ isAdmin: false }, activationState(demoSeller, SOLD)) === false);

  /* ------------- V.Admin against the real vendor population -------------- */
  {
    const rows = await loadVendorActivationRows();
    const find = (n: string) => rows.find((r) => r.storeName === n);
    const counted = rows.filter((r) => r.outreachable);

    // Compare against the table, not a hard-coded count — the latter asserts
    // the environment and breaks whenever a vendor is added or removed.
    const sellerCount = await prisma.seller.count();
    check("V.Admin loader returns every seller",
      rows.length === sellerCount, `loader=${rows.length} table=${sellerCount}`);
    // Was: `find("Grandies")?.attention === "needs_help"`. That asserted one
    // named vendor's TRANSIENT state, and broke the day that account was
    // replaced — exactly the failure the comment above warns about. The
    // invariant is what mattered: demonstrated intent without the ability to
    // take payment is always worth an admin's attention, whoever it is.
    {
      const shouldBeFlagged = rows.filter(
        (r) => !r.state.readyToSell && r.facts.dropsWithProducts > 0 && r.state.stage !== "paused"
      );
      check("V.Admin every vendor with a drop and no Stripe is flagged needs_help",
        shouldBeFlagged.every((r) => r.attention === "needs_help"),
        shouldBeFlagged.filter((r) => r.attention !== "needs_help")
          .map((r) => `${r.storeName}=${r.attention}`).join(", "));
      check("V.Admin nobody is flagged needs_help without demonstrated intent",
        rows.filter((r) => r.attention === "needs_help")
          .every((r) => r.facts.dropsWithProducts > 0 && !r.state.readyToSell),
        rows.filter((r) => r.attention === "needs_help")
          .map((r) => `${r.storeName}:drops=${r.facts.dropsWithProducts}`).join(", "));
    }
    check("V.Admin The Clovery (selling) is not flagged",
      find("The Clovery")?.attention === "none");
    check("V.Admin Paraiso (selling) is not flagged",
      find("Paraiso Delicacies")?.attention === "none");
    check("V.Admin Casa Makulay (charge-ready) is not flagged",
      find("Casa Makulay")?.attention === "none");
    check("V.Admin Marble & Crumb is demo-excluded",
      find("Marble & Crumb")?.state.applicable === false &&
      find("Marble & Crumb")?.outreachable === false);
    check("V.Admin DropQ Admin is internal, excluded from counts",
      find("DropQ Admin")?.outreachable === false);
    check("V.Admin Britts Bunnies is internal, excluded from counts",
      find("Britts Bunnies")?.outreachable === false);
    check("V.Admin no demo or internal account is counted",
      counted.every((r) => r.state.applicable && !r.isAdmin));
    check("V.Admin loader agrees with the pure derivation",
      rows.every((r) => r.attention === attentionState(r.state, r.facts)));
    check("V.Admin every row exposes what the page needs",
      rows.every((r) => typeof r.totalDrops === "number" &&
        typeof r.draftDrops === "number" && !!r.email && !!r.storeName));

    live["__attention"] = rows
      .map((r) => `${r.storeName}=${r.attention}${r.outreachable ? "" : "(excl)"}`)
      .join(", ");
  }

  /* ---------------------- V.3 publish gate (UX only) --------------------- */
  const gate = (sel: ActivationSeller, f: ActivationFacts = HAS_DROP) =>
    publishGate(activationState(sel, f));

  check("V.3 charge-ready vendor is NOT gated — publishing unchanged",
    gate(READY) === null && gate(READY, PUBLISHED) === null && gate(READY, SOLD) === null);
  check("V.3 not started -> Connect Stripe",
    gate(NOT_STARTED)?.cta === "Connect Stripe");
  check("V.3 not started copy names the constraint, not an error",
    /Publishing needs Stripe/.test(gate(NOT_STARTED)!.reason));
  check("V.3 incomplete/unknown -> Finish Stripe setup, never 'Connect'",
    gate(INCOMPLETE)?.cta === "Finish Stripe setup");
  check("V.3 restricted -> Fix this in Stripe",
    gate(RESTRICTED)?.cta === "Fix this in Stripe");
  check("V.3 restricted copy says payments are paused",
    /paused/i.test(gate(RESTRICTED)!.reason));
  check("V.3 suspended is gated too (never null)", gate(SUSPENDED) !== null);
  check("V.3 every gate routes to the existing payments flow",
    [NOT_STARTED, INCOMPLETE, RESTRICTED, SUSPENDED]
      .every((v) => gate(v)!.href === "/dashboard/payments"));
  check("V.3 gate never depends on drops or orders — only on Stripe",
    JSON.stringify(gate(NOT_STARTED, NOTHING)) === JSON.stringify(gate(NOT_STARTED, SOLD)));
  check("V.3 gate copy contains no error language",
    [NOT_STARTED, INCOMPLETE, RESTRICTED].every((v) =>
      !/error|fail|cannot|denied|!/i.test(gate(v)!.reason)));

  /* -------- V.3 surfaces: gated markup present, ungated unchanged -------- */
  {
    const editor = readFileSync("components/drop-editor.tsx", "utf8");
    check("V.3 editor gates create mode only",
      /mode === "create" && publishGate/.test(editor));
    check("V.3 editor keeps Save as draft as the submit when gated",
      /publishGate[\s\S]{0,900}name="status" value="draft"/.test(editor));
    check("V.3 editor gated branch offers no live submit",
      !/mode === "create" && publishGate[\s\S]{0,700}value="live"/.test(editor));
    check("V.3 edit mode is untouched — still submits the existing status",
      /name="status" value=\{status\}/.test(editor));

    const detail = readFileSync("app/dashboard/drops/[id]/page.tsx", "utf8");
    check("V.3 drop detail computes the gate", /publishGate\(await loadActivationState/.test(detail));
    check("V.3 draft publish is gated", /gate \? \([\s\S]{0,400}to publish/.test(detail));
    check("V.3 closed reopen is gated", /gate \? \([\s\S]{0,400}to reopen/.test(detail));
    check("V.3 'Close drop' is never gated — taking a drop down always works",
      /status === "live"[\s\S]{0,300}value="closed"/.test(detail) &&
      !/status === "live" &&\s*\(gate/.test(detail));
    check("V.3 duplicate banner suppressed when the inline gate shows",
      /\) : gate \? \([\s\S]{0,700}\) : \([\s\S]{0,120}StripeRequiredBanner/.test(detail));

    const newDrop = readFileSync("app/dashboard/drops/new/page.tsx", "utf8");
    check("V.3 new-drop page passes the gate", /publishGate=\{gate\}/.test(newDrop));

    const editPage = readFileSync("app/dashboard/drops/[id]/edit/page.tsx", "utf8");
    check("V.3 edit page deliberately untouched", !/publishGate/.test(editPage));

    check("V.3 no Stripe messaging added to the product library",
      !/Stripe/i.test(readFileSync("components/product-library.tsx", "utf8")));
  }

  /* ---- V.3 changes NO server enforcement (the forged-request guarantee) --- */
  {
    const dash = readFileSync("lib/actions/dashboard.ts", "utf8");
    const pay = readFileSync("lib/payments.ts", "utf8");
    const order = readFileSync("lib/actions/order.ts", "utf8");
    for (const fn of ["createDropAction", "updateDropFullAction", "updateDropStatusAction"]) {
      const body = dash.slice(dash.indexOf(`function ${fn}`), dash.indexOf(`function ${fn}`) + 2200);
      check(`V.3 ${fn} still routes status through resolveDropStatus`,
        body.includes("resolveDropStatus("));
    }
    check("V.3 resolveDropStatus still blocks a non-sellable live transition",
      /status === "live" && current !== "live" && !isVendorSellable\(seller\)/.test(pay));
    check("V.3 resolveDropStatus still always permits leaving live",
      /current !== "live"/.test(pay));
    check("V.3 placeOrderAction still gates on isVendorSellable",
      /if \(!isVendorSellable\(drop\.seller\)\)/.test(order));
    check("V.3 the publish gate never appears in a server action",
      !dash.includes("publishGate") && !order.includes("publishGate"));
  }

  /* ------------------------- Purity / no enforcement --------------------- */
  {
    const a = activationState(READY, HAS_DROP);
    const b = activationState(READY, HAS_DROP);
    check("derivation is pure (same input, same output)",
      JSON.stringify(a) === JSON.stringify(b));
  }

  /* -------------------- Every real seller derives sanely ----------------- */
  const sellers = await prisma.seller.findMany({
    select: {
      id: true, storeName: true, email: true, slug: true, emailVerified: true,
      disabledAt: true, stripeAccountId: true, stripeChargesEnabled: true,
    },
  });
  for (const s of sellers) {
    const state = activationState(s, await activationFacts(s.id));
    live[s.storeName] =
      `${state.stripe} · ${state.completed}/${state.total} · ${state.stage}` +
      `${state.applicable ? "" : " · EXCLUDED"} · next=${state.nextAction?.key ?? "none"}`;
    check(`${s.storeName}: derives a valid state`,
      state.total === 5 && state.completed >= 1 && state.completed <= 5);
    check(`${s.storeName}: readyToSell agrees with Stripe state`,
      state.readyToSell === (state.stripe === "charge_ready"));
    check(`${s.storeName}: a complete vendor has no next action`,
      state.stage !== "complete" || state.nextAction === null || state.nextAction.key === "share");
  }

  const passed = results.filter((r) => r.pass).length;
  return NextResponse.json(
    {
      suite: "activation",
      passed,
      failed: results.length - passed,
      production: live,
      results: results.filter((r) => !r.pass).length ? results.filter((r) => !r.pass) : "all pass",
    },
    { status: passed === results.length ? 200 : 500 }
  );
}
