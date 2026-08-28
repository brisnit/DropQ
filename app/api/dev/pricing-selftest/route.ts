import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calcFeeCents, feePercent } from "@/lib/stripe";
import {
  PRICING,
  GROWTH_PRICE_CENTS,
  PRO_PRICE_CENTS,
  PRO_FEE_PERCENT,
  STARTER_DROP_LIMIT,
  feePercentForPlan,
  effectivePlan,
  planLabel,
  dropLimit,
  canCreateDrop,
  dropsRemaining,
} from "@/lib/plans";

/**
 * Development-only cover for the pricing structure: Free / Basic $8 / Pro $14.
 *
 * Pricing is the one part of this app where being quietly wrong costs a vendor
 * money, so this checks three separate things that can drift apart:
 *
 * 1. The NUMBERS agree everywhere — the constants, the plan cards, and the
 *    marketing pages a vendor actually reads. A price lives in several files;
 *    changing one and missing another is the obvious failure.
 * 2. Pro is PRICED but not purchasable. It gates nothing in code and has no
 *    Stripe price, so anything that lets a vendor pay for it is a bug until
 *    its features exist.
 * 3. The FEE follows the plan. Pro advertises 1.5%; everyone else pays the
 *    platform default. The fee is computed in the order path, so a seller that
 *    never reaches calcFeeCents means the advertised rate is fiction.
 *
 * Fixtures are torn down in a `finally` and counts asserted back to baseline.
 * No Stripe call is made and no order is created.
 */

type Check = { name: string; pass: boolean; detail?: string };

const TRACKED: Record<string, () => Promise<number>> = {
  seller: () => prisma.seller.count(),
};

/** A seller shaped just enough for the plan/fee helpers. */
const asSeller = (plan: string) => ({
  plan,
  partnerExpiresAt: null,
  dropsCreated: 0,
  growthBonusUntil: null,
});

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail });

  const baseline: Record<string, number> = {};
  for (const [m, count] of Object.entries(TRACKED)) baseline[m] = await count();

  const origin = new URL(req.url).origin;
  const clean = (h: string) => h.replace(/<!--[\s\S]*?-->/g, "");
  /**
   * The text a vendor can actually read. React's RSC payload is inlined in
   * <script> tags and is dense with "$20"-style reference ids, which look
   * exactly like stale prices to a naive grep — the first version of this
   * check failed on them.
   */
  const visible = (h: string) =>
    h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ");
  const get = async (path: string) => {
    const r = await fetch(origin + path, { redirect: "manual" });
    return { status: r.status, body: r.status === 200 ? clean(await r.text()) : "" };
  };

  const card = (id: string) => PRICING.find((c) => c.id === id);

  try {
    // ---- 1. The numbers -----------------------------------------------------
    check("Free keeps a 3-drop allowance", STARTER_DROP_LIMIT === 3, String(STARTER_DROP_LIMIT));
    check("Basic is $8/mo", GROWTH_PRICE_CENTS === 800, `${GROWTH_PRICE_CENTS} cents`);
    check("Pro is $14/mo", PRO_PRICE_CENTS === 1400, `${PRO_PRICE_CENTS} cents`);

    // The cards are what a vendor reads; the constants are what Stripe charges.
    // They are separate values and must not be allowed to disagree.
    check("the Free card shows $0", card("starter")?.price === "$0", card("starter")?.price);
    check("the Basic card matches GROWTH_PRICE_CENTS",
      card("growth")?.price === `$${GROWTH_PRICE_CENTS / 100}`, card("growth")?.price);
    check("the Pro card matches PRO_PRICE_CENTS",
      card("pro")?.price === `$${PRO_PRICE_CENTS / 100}`, card("pro")?.price);
    check("the cards are named Free / Basic / Pro",
      card("starter")?.name === "Free" && card("growth")?.name === "Basic" && card("pro")?.name === "Pro",
      PRICING.map((c) => c.name).join(", "));
    check("the Free card still states the 3-drop limit",
      !!card("starter")?.features.some((f) => f.includes(String(STARTER_DROP_LIMIT))));

    check("plan labels read Free / Basic / Partner / Pro",
      planLabel("starter") === "Free" && planLabel("growth") === "Basic"
        && planLabel("partner") === "Partner" && planLabel("pro") === "Pro");

    // ---- 2. Pro is priced, not purchasable ---------------------------------
    check("Pro is still flagged Coming Soon", card("pro")?.comingSoon === true);
    check("Pro's CTA does not invite payment",
      !/upgrade|subscribe|start|buy/i.test(card("pro")?.cta ?? ""), card("pro")?.cta);
    // Match the plan VALUE, not the substring — "process"/"promotion" are not
    // Pro checkouts, and the first version of this check thought they were.
    const billingSrc = readFileSync("lib/billing.ts", "utf8");
    const proPlanValue = /["']pro["']/;
    check("there is no Pro checkout path", !proPlanValue.test(billingSrc),
      "lib/billing.ts must not create a Pro subscription while Pro is Coming Soon");
    const billingActionSrc = readFileSync("lib/actions/billing.ts", "utf8");
    check("no server action starts a Pro subscription", !proPlanValue.test(billingActionSrc));
    const plansSrc = readFileSync("lib/plans.ts", "utf8");
    check("no Stripe price lookup key exists for Pro",
      !/PRO_PRICE_LOOKUP_KEY/.test(plansSrc));

    // Pro's advertised list must not promise what Basic already gives, or the
    // $6 gap has no story at all.
    const proOnly = (card("pro")?.features ?? []).filter((f) => f !== "Everything in Basic");
    check("Pro advertises something beyond Basic", proOnly.length > 0);
    check("Pro's headline claim is the reduced fee",
      proOnly.some((f) => f.includes(String(PRO_FEE_PERCENT))), proOnly[0]);

    // ---- 3. The fee follows the plan ---------------------------------------
    const dflt = feePercent();
    check("the platform default fee is unchanged", dflt === 2, `${dflt}%`);
    check("Pro's advertised rate is the one the code uses",
      feePercentForPlan("pro", dflt) === PRO_FEE_PERCENT, `${feePercentForPlan("pro", dflt)}%`);
    for (const p of ["starter", "growth", "partner"] as const) {
      check(`${p} pays the platform default`, feePercentForPlan(p, dflt) === dflt);
    }
    // A lower global fee must never RAISE what Pro pays.
    check("Pro's rate is a ceiling, not a fixed rate", feePercentForPlan("pro", 1) === 1);

    check("a $100 sale costs a Free seller $2.00",
      calcFeeCents(10000, asSeller("starter")) === 200,
      String(calcFeeCents(10000, asSeller("starter"))));
    check("a $100 sale costs a Basic seller $2.00",
      calcFeeCents(10000, asSeller("growth")) === 200,
      String(calcFeeCents(10000, asSeller("growth"))));
    check("a $100 sale costs a Pro seller $1.50",
      calcFeeCents(10000, asSeller("pro")) === 150,
      String(calcFeeCents(10000, asSeller("pro"))));
    check("omitting the seller falls back to the platform default",
      calcFeeCents(10000) === 200, String(calcFeeCents(10000)));

    // An expired Partner bills as Basic, so it must also pay Basic's fee.
    const expiredPartner = { ...asSeller("partner"), partnerExpiresAt: new Date(Date.now() - 86400_000) };
    check("an expired Partner is treated as Basic for the fee",
      effectivePlan(expiredPartner) === "growth" && calcFeeCents(10000, expiredPartner) === 200);

    // The rate is only real if the order path passes the seller in.
    for (const f of ["lib/actions/order.ts", "lib/actions/pay.ts"]) {
      const src = readFileSync(f, "utf8");
      check(`${f}: the fee is computed from the seller's plan`,
        /calcFeeCents\([^)]*,\s*\w+\.seller\)/.test(src),
        (src.match(/calcFeeCents\([^)]*\)/) ?? ["none"])[0]);
    }

    // ---- 4. Stripe cannot bill a stale price --------------------------------
    // Prices are immutable, so repricing means a NEW Price. Handing back
    // whatever the lookup key points at would charge the old amount while the
    // page shows the new one.
    const stripeSrc = readFileSync("lib/stripe.ts", "utf8");
    check("ensureGrowthPriceId verifies the amount before reusing a price",
      /unit_amount === GROWTH_PRICE_CENTS/.test(stripeSrc));
    check("a repriced plan transfers its lookup key to the new price",
      /transfer_lookup_key:\s*true/.test(stripeSrc));

    // The referral credit is one month of the paid plan; hard-coding it would
    // have silently become 2.5 free months when the price dropped.
    const refSrc = readFileSync("lib/referral.ts", "utf8");
    check("the referral credit tracks the plan price rather than a literal",
      /amount:\s*-GROWTH_PRICE_CENTS/.test(refSrc));

    // ---- 5. Gating still works ---------------------------------------------
    check("Free is capped at the drop limit", dropLimit("starter") === STARTER_DROP_LIMIT);
    for (const p of ["growth", "partner", "pro"] as const) {
      check(`${p} has unlimited drops`, dropLimit(p) === Infinity);
    }
    const fresh = asSeller("starter");
    check("a new Free seller can create drops",
      canCreateDrop(fresh) && dropsRemaining(fresh) === STARTER_DROP_LIMIT);
    const used = { ...asSeller("starter"), dropsCreated: STARTER_DROP_LIMIT };
    check("a Free seller is blocked at the limit",
      !canCreateDrop(used) && dropsRemaining(used) === 0);

    // ---- 6. The pages a vendor actually reads ------------------------------
    for (const [label, path] of [["pricing", "/pricing"], ["home", "/"]] as const) {
      const page = await get(path);
      check(`${label} page renders`, page.status === 200, `status=${page.status}`);
      const text = visible(page.body);
      check(`${label} page shows $8`, text.includes("$8"));
      check(`${label} page shows $14`, text.includes("$14"));
      check(`${label} page no longer shows the old $20`, !/\$20\b/.test(text),
        (text.match(/.{40}\$20\b.{40}/) ?? [""])[0]);
      check(`${label} page no longer shows the old $99`, !/\$99\b/.test(text),
        (text.match(/.{40}\$99\b.{40}/) ?? [""])[0]);
      check(`${label} page names the tiers Free / Basic / Pro`,
        text.includes("Basic") && text.includes("Pro") && text.includes("Free"));
      // "Customer Growth" is a benefit heading, not a tier — the plan formerly
      // called Growth is what must be gone.
      const noBenefitCopy = text.replace(/Customer Growth/g, " ");
      check(`${label} page no longer names a Growth plan`, !/\bGrowth\b/.test(noBenefitCopy),
        (noBenefitCopy.match(/.{40}\bGrowth\b.{40}/) ?? [""])[0]);
    }
  } catch (e) {
    check("selftest ran without an unexpected exception", false,
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));
  } finally {
    for (const [m, count] of Object.entries(TRACKED)) {
      const now = await count();
      check(`teardown restored ${m} to baseline`, now === baseline[m], `${baseline[m]} -> ${now}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json({
    suite: "pricing-selftest",
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  });
}
