import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  activationState,
  stripeActivationState,
  stripeBlocksSelling,
  activationFacts,
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

const NOTHING: ActivationFacts = { dropsWithProducts: 0, liveDrops: 0, paidOrders: 0 };
const HAS_DROP: ActivationFacts = { dropsWithProducts: 1, liveDrops: 0, paidOrders: 0 };
const PUBLISHED: ActivationFacts = { dropsWithProducts: 1, liveDrops: 1, paidOrders: 0 };
const SOLD: ActivationFacts = { dropsWithProducts: 1, liveDrops: 1, paidOrders: 3 };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results: Result[] = [];
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
    // NOT_STARTED is email-verified, so account + email are done.
    const s = activationState(NOT_STARTED, NOTHING);
    check("verified vendor with no Stripe and no drop: 2 of 5",
      s.completed === 2 && s.total === 5, `completed=${s.completed}`);
    check("only Stripe is marked required to sell",
      s.milestones.filter((m) => m.requiredToSell).map((m) => m.key).join() === "stripe");
    check("account milestone is always done",
      s.milestones.find((m) => m.key === "account")!.done);
  }
  {
    const s = activationState({ ...NOT_STARTED, emailVerified: false }, NOTHING);
    check("unverified brand-new vendor: 1 of 5", s.completed === 1);
  }
  check("a live drop completes 'publish'",
    activationState(READY, PUBLISHED).milestones.find((m) => m.key === "publish")!.done);
  check("a paid order completes 'publish' even with no live drop now",
    activationState(READY, { dropsWithProducts: 1, liveDrops: 0, paidOrders: 1 })
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
  check("fully activated and selling -> no next action",
    activationState(READY, SOLD).nextAction === null);
  check("unverified email is asked for last, only after selling works",
    activationState({ ...READY, emailVerified: false }, SOLD).nextAction!.key === "email");
  check("suspended vendor gets no self-service next action",
    activationState(SUSPENDED, NOTHING).nextAction === null);

  /* --------------------------- Demo-store exclusion ---------------------- */
  check("the marketing showcase is excluded by slug",
    activationState({ ...NOT_STARTED, slug: "marble-crumb" }, HAS_DROP).applicable === false);
  check("the marketing showcase is excluded by email",
    activationState({ ...NOT_STARTED, email: "showcase@dropq.example" }, HAS_DROP)
      .applicable === false);
  check("a real vendor is applicable", activationState(NOT_STARTED, HAS_DROP).applicable === true);

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
  const live: Record<string, string> = {};
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
      state.stage !== "complete" || state.nextAction === null || state.nextAction.key === "email");
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
