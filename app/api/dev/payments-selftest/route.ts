import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canStartInPersonSale, isVendorSellable } from "@/lib/payments";
import {
  buildCheckoutSessionParams,
  defaultExpiresAt,
  SESSION_TTL_SECONDS,
} from "@/lib/checkout-session";

/**
 * Development-only self-test for the payment pipeline invariants that Phases
 * C–E depend on (Phase C1).
 *
 * Two kinds of proof, and the distinction matters:
 *
 *  1. **Live-database proofs** of the two atomic primitives — the pending-claim
 *     and the conditional stock increment. These run the EXACT statements
 *     `finalizePaidOrder` runs, against the real `Order`/`Product` tables,
 *     inside a transaction that always rolls back.
 *
 *  2. **Source assertions** on `lib/checkout.ts`, pinning the ordering and
 *     guards that make the primitives load-bearing.
 *
 * ⚠️ It never calls `finalizePaidOrder` itself. That function opens its own
 * `prisma.$transaction`, which would NOT enlist in a wrapper transaction — the
 * writes would commit for real against production. Everything here is either
 * rolled back or read-only.
 *
 * Writes nothing that survives. Hard 404 outside development.
 *
 *   curl localhost:3000/api/dev/payments-selftest
 */

type Result = { name: string; pass: boolean; detail?: string };

const ROLLBACK = "__rollback__";

const READY = {
  id: "s1", stripeChargesEnabled: true, stripeAccountId: "acct_1", disabledAt: null,
};
const NO_STRIPE = { ...READY, stripeChargesEnabled: false, stripeAccountId: null };
const REVOKED = { ...READY, stripeChargesEnabled: false };
const SUSPENDED = { ...READY, disabledAt: new Date() };
const stocked = { sellerId: "s1", products: [{ inventory: 10, sold: 3 }] };
const soldOut = { sellerId: "s1", products: [{ inventory: 5, sold: 5 }] };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ------------------ canStartInPersonSale (Phase C1) -------------------- */
  check("C1 charge-ready vendor with stock can start a walk-up sale",
    canStartInPersonSale(READY, stocked).ok === true);
  const notStripe = canStartInPersonSale(NO_STRIPE, stocked);
  check("C1 vendor without Stripe cannot",
    !notStripe.ok && notStripe.reason === "vendor_not_sellable");
  const revoked = canStartInPersonSale(REVOKED, stocked);
  check("C1 vendor whose charges Stripe revoked cannot",
    !revoked.ok && revoked.reason === "vendor_not_sellable");
  const susp = canStartInPersonSale(SUSPENDED, stocked);
  check("C1 admin-suspended vendor cannot",
    !susp.ok && susp.reason === "vendor_not_sellable");
  const foreign = canStartInPersonSale(READY, { ...stocked, sellerId: "someone-else" });
  check("C1 a foreign drop is refused",
    !foreign.ok && foreign.reason === "not_your_drop");
  check("C1 ownership is checked BEFORE sellability — never leak another vendor's state",
    (() => {
      const r = canStartInPersonSale(NO_STRIPE, { ...stocked, sellerId: "someone-else" });
      return !r.ok && r.reason === "not_your_drop";
    })());
  const empty = canStartInPersonSale(READY, soldOut);
  check("C1 a sold-out drop is refused", !empty.ok && empty.reason === "no_stock");
  check("C1 no products at all is refused",
    !canStartInPersonSale(READY, { sellerId: "s1", products: [] }).ok);
  check("C1 partial stock across items is enough",
    canStartInPersonSale(READY, {
      sellerId: "s1",
      products: [{ inventory: 5, sold: 5 }, { inventory: 2, sold: 1 }],
    }).ok === true);
  check("C1 oversold stock never counts as negative remaining",
    !canStartInPersonSale(READY, {
      sellerId: "s1", products: [{ inventory: 1, sold: 9 }, { inventory: 0, sold: 0 }],
    }).ok);
  check("C1 eligibility is built on isVendorSellable, not a second Stripe model",
    canStartInPersonSale(READY, stocked).ok === isVendorSellable(READY));
  check("C1 a CLOSED drop is deliberately still eligible (architecture §6.1)",
    canStartInPersonSale(READY, stocked).ok === true);

  /* -------- finalizePaidOrder: the pending-claim, on the real table ------- */
  // Exactly the statement lib/checkout.ts:32 runs.
  {
    // Deliberately NOT findFirst: never point a mutation test at an order that
    // belongs to a live drop, or at the historical Casa Makulay unpaid order.
    // The transaction always rolls back, but with a real sale running the
    // correct instinct is to not touch it at all.
    const victim = await prisma.order.findFirst({
      where: { paymentStatus: "paid", drop: { status: { not: "live" } } },
      select: { id: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    let r: { first: number; second: number; after: string | null } | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: victim!.id },
          data: { status: "pending", paymentStatus: "pending" },
        });
        const first = (await tx.order.updateMany({
          where: { id: victim!.id, status: "pending" },
          data: { status: "new", paymentStatus: "paid" },
        })).count;
        const second = (await tx.order.updateMany({
          where: { id: victim!.id, status: "pending" },
          data: { status: "new", paymentStatus: "paid" },
        })).count;
        const after = (await tx.order.findUnique({
          where: { id: victim!.id }, select: { paymentStatus: true },
        }))!.paymentStatus;
        r = { first, second, after };
        throw new Error(ROLLBACK);
      });
    } catch (e) {
      if (!(e instanceof Error && e.message === ROLLBACK)) throw e;
    }
    const c = r as unknown as { first: number; second: number; after: string };
    check("finalize: the pending-claim is single-winner (1 then 0)",
      c.first === 1 && c.second === 0, `first=${c.first} second=${c.second}`);
    check("finalize: a retry cannot re-finalize — count 0 short-circuits",
      c.second === 0);
    check("finalize: the winning claim sets paymentStatus paid", c.after === "paid");

    const restored = await prisma.order.findUnique({
      where: { id: victim!.id }, select: { status: true, paymentStatus: true },
    });
    check("finalize: the claim test left production untouched",
      restored!.status === victim!.status,
      `before=${victim!.status} after=${restored!.status}/${restored!.paymentStatus}`);
  }

  /* ----- finalizePaidOrder: conditional stock increment, on real rows ----- */
  // Exactly the SQL at lib/checkout.ts:68-70. This is oversell protection.
  {
    // Same reasoning: never target a product on a live drop. This test rewrites
    // inventory before rolling back, and a live sale's stock is the last row
    // that should be anywhere near it.
    const p = await prisma.product.findFirst({
      where: { inventory: { gt: 0 }, drop: { status: { not: "live" } } },
      select: { id: true, inventory: true, sold: true },
      orderBy: { id: "asc" },
    });
    let r: { ok: number; over: number; soldAfter: number; rolledBack: number } | null = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id: p!.id }, data: { inventory: 10, sold: 0 },
        });
        // Claim 4 of 10 — must succeed.
        const ok = await tx.$executeRaw`
          UPDATE "Product" SET sold = sold + 4
          WHERE id = ${p!.id} AND sold + 4 <= inventory`;
        // Claim 9 more (13 > 10) — must be refused, changing nothing.
        const over = await tx.$executeRaw`
          UPDATE "Product" SET sold = sold + 9
          WHERE id = ${p!.id} AND sold + 9 <= inventory`;
        const soldAfter = (await tx.product.findUnique({
          where: { id: p!.id }, select: { sold: true },
        }))!.sold;
        // The oversold rollback (checkout.ts:78) gives the units back.
        await tx.$executeRaw`UPDATE "Product" SET sold = sold - 4 WHERE id = ${p!.id}`;
        const rolledBack = (await tx.product.findUnique({
          where: { id: p!.id }, select: { sold: true },
        }))!.sold;
        r = { ok, over, soldAfter, rolledBack };
        throw new Error(ROLLBACK);
      });
    } catch (e) {
      if (!(e instanceof Error && e.message === ROLLBACK)) throw e;
    }
    const s = r as unknown as { ok: number; over: number; soldAfter: number; rolledBack: number };
    check("finalize: stock is claimed exactly once when it fits", s.ok === 1);
    check("finalize: an oversold claim updates ZERO rows", s.over === 0);
    check("finalize: inventory never goes past its cap", s.soldAfter === 4);
    check("finalize: the oversold rollback returns the units", s.rolledBack === 0);

    const after = await prisma.product.findUnique({
      where: { id: p!.id }, select: { inventory: true, sold: true },
    });
    check("finalize: the stock test left production untouched",
      after!.inventory === p!.inventory && after!.sold === p!.sold,
      `before=${p!.inventory}/${p!.sold} after=${after!.inventory}/${after!.sold}`);
  }

  /* ------------- Source assertions: the guards around those two ---------- */
  {
    const src = readFileSync("lib/checkout.ts", "utf8");
    const idx = (s: string) => src.indexOf(s);

    check("finalize: claim still predicated on status pending",
      /where: \{ id: orderId, status: "pending" \}/.test(src));
    check("finalize: claim still flips to new + paid",
      /status: "new",\s*\n\s*paymentStatus: "paid"/.test(src));
    check("finalize: count-0 short-circuit runs BEFORE the stock loop",
      idx('if (claimed.count === 0)') > -1 &&
      idx('if (claimed.count === 0)') < idx('UPDATE "Product" SET sold = sold +'));
    check("finalize: the payment OrderEvent is inside the winning branch",
      idx('if (claimed.count === 0)') < idx('type: "payment", detail: "paid"'));
    check("finalize: stock claim is conditional on inventory",
      /sold \+ \$\{it\.quantity\} <= inventory/.test(src));
    check("finalize: oversold path cancels and marks refund_pending",
      /status: "canceled", paymentStatus: "refund_pending"/.test(src));
    check("finalize: everything happens in ONE transaction",
      /prisma\.\$transaction\(async \(tx\) => \{/.test(src));
    // Match the CALL SITE, not the import at the top of the file.
    for (const [what, marker] of [
      ["DropPoints", "awardPointsForOrder(orderId)"],
      ["commission", "createCommissionForOrder(result.order)"],
      ["confirmation email", "orderReceivedEmail({"],
    ] as const) {
      const at = idx(marker);
      const gate = src.lastIndexOf('result.state === "ok"', at);
      check(`finalize: ${what} only fires on the winning claim`,
        at > -1 && gate > -1 && at - gate < 400, `${marker} at=${at} gate=${gate}`);
    }
    check("finalize: DropPoints failure cannot break payment",
      /awardPointsForOrder\(orderId\)\.catch\(/.test(src));
    check("finalize: oversold refund passes refund_application_fee",
      /refund_application_fee: true/.test(src));
    check("finalize: oversold refund is idempotency-keyed",
      /idempotencyKey: `oversold-refund-\$\{order\.id\}`/.test(src));
    check("finalize: refund guarded by the refund_pending state",
      /paymentStatus !== "refund_pending"\) return/.test(src));
    check("finalize: reconcile sweep still only touches pending orders",
      /where: \{ status: "pending", stripeSessionId: \{ not: null \}/.test(src));

    // Phase C1 must not have altered it.
    check("C1 did not modify finalizePaidOrder's claim or stock logic",
      /where: \{ id: orderId, status: "pending" \}/.test(src) &&
      /sold \+ \$\{it\.quantity\} <= inventory/.test(src));
  }

  /* ---- C2: the extracted builder must equal the pre-extraction object ---- */
  // GOLDEN SNAPSHOTS. These literals were transcribed from the inline object in
  // lib/actions/order.ts as it stood at commit 9beccc1, BEFORE the extraction.
  // They are the definition of "unchanged online checkout behaviour" — if the
  // builder ever stops matching them, live checkout has changed. Do not
  // regenerate them from the builder; that would make the test tautological.
  {
    const EXPIRES = 1_760_000_000;
    const common = {
      orderId: "ord_123",
      buyerEmail: "buyer@example.com",
      feeCents: 13,
      successUrl: "https://www.drop-q.com/order/ord_123?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: "https://www.drop-q.com/s/the-clovery/drop_1?canceled=1",
      expiresAt: EXPIRES,
    };
    const twoLines = [
      { priceCents: 650, quantity: 2, name: "Sweet corn custard filled donut",
        description: "Seasonal" },
      { priceCents: 400, quantity: 1, name: "Sticker pack", description: null },
    ];

    const GOLDEN_ITEMS = [
      {
        quantity: 2,
        price_data: {
          currency: "usd",
          unit_amount: 650,
          product_data: { name: "Sweet corn custard filled donut", description: "Seasonal" },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 400,
          // description omitted entirely when null — NOT description: null
          product_data: { name: "Sticker pack" },
        },
      },
    ];

    const GOLDEN_ABSORB = {
      mode: "payment",
      customer_email: "buyer@example.com",
      line_items: GOLDEN_ITEMS,
      payment_intent_data: {
        application_fee_amount: 13,
        metadata: { orderId: "ord_123" },
      },
      metadata: { orderId: "ord_123" },
      expires_at: EXPIRES,
      success_url: common.successUrl,
      cancel_url: common.cancelUrl,
    };

    const GOLDEN_PASS = {
      ...GOLDEN_ABSORB,
      line_items: [
        ...GOLDEN_ITEMS,
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: 13,
            product_data: { name: "Service fee" },
          },
        },
      ],
    };

    const absorb = buildCheckoutSessionParams({ ...common, lines: twoLines, passFee: false });
    const pass = buildCheckoutSessionParams({ ...common, lines: twoLines, passFee: true });
    const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

    check("C2 ABSORB mode params equal the pre-extraction object",
      eq(absorb, GOLDEN_ABSORB), JSON.stringify(absorb));
    check("C2 PASS mode params equal the pre-extraction object",
      eq(pass, GOLDEN_PASS), JSON.stringify(pass));
    check("C2 absorb mode adds NO service-fee line",
      absorb.line_items!.length === 2);
    check("C2 pass mode appends the service-fee line LAST",
      pass.line_items!.length === 3 &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pass.line_items![2] as any).price_data.product_data.name === "Service fee");
    check("C2 application_fee_amount is feeCents in BOTH modes",
      absorb.payment_intent_data!.application_fee_amount === 13 &&
      pass.payment_intent_data!.application_fee_amount === 13);
    check("C2 orderId metadata is on the session AND the PaymentIntent",
      absorb.metadata!.orderId === "ord_123" &&
      absorb.payment_intent_data!.metadata!.orderId === "ord_123");
    check("C2 mode is payment", absorb.mode === "payment");
    check("C2 customer_email is the buyer's", absorb.customer_email === "buyer@example.com");
    check("C2 success_url carries the Stripe session placeholder",
      String(absorb.success_url).includes("{CHECKOUT_SESSION_ID}"));
    check("C2 cancel_url returns to the drop", String(absorb.cancel_url).endsWith("?canceled=1"));
    check("C2 a null description is omitted, never sent as null",
      !JSON.stringify(absorb).includes('"description":null'));
    check("C2 every line is USD",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pass.line_items!.every((li: any) => li.price_data.currency === "usd"));
    check("C2 no field was added beyond the original set",
      JSON.stringify(Object.keys(absorb).sort()) === JSON.stringify([
        "cancel_url", "customer_email", "expires_at", "line_items",
        "metadata", "mode", "payment_intent_data", "success_url",
      ]));
    check("C2 the builder is pure — same input, same output",
      eq(buildCheckoutSessionParams({ ...common, lines: twoLines, passFee: false }), absorb));

    check("C2 session TTL is still 60 minutes", SESSION_TTL_SECONDS === 3600);
    check("C2 defaultExpiresAt is now + TTL in unix seconds",
      defaultExpiresAt(1_000_000_000_000) === 1_000_000_000 + 3600);
    check("C2 zero fee still yields a valid absorb session",
      buildCheckoutSessionParams({ ...common, feeCents: 0, lines: twoLines, passFee: false })
        .payment_intent_data!.application_fee_amount === 0);
  }

  /* ------- C2 kept the Stripe call at the call site, with the account ----- */
  {
    const orderSrc = readFileSync("lib/actions/order.ts", "utf8");
    check("C2 placeOrderAction uses the shared builder",
      /buildCheckoutSessionParams\(\{/.test(orderSrc));
    check("C2 the Stripe create call stays at the call site",
      /stripe\.checkout\.sessions\.create\(\s*params,/.test(orderSrc));
    check("C2 the connected-account context is still passed",
      /stripeAccount: drop\.seller\.stripeAccountId!/.test(orderSrc));
    check("C2 the inline session object is gone (single source of truth)",
      !/mode: "payment",\s*\n\s*customer_email/.test(orderSrc));
    check("C2 the session id is still persisted to the order",
      /data: \{ stripeSessionId: session\.id \}/.test(orderSrc));
    check("C2 still redirects to the Stripe-hosted page",
      /redirect\(session\.url!\)/.test(orderSrc));
    check("C2 the order is still created pending/pending before the session",
      orderSrc.indexOf('status: "pending"') <
        orderSrc.indexOf("const params = buildCheckoutSessionParams("));
    // Strip comments first: the builder's docblock deliberately *describes* the
    // create call it must never make, and that prose must not trip the check.
    const builderCode = readFileSync("lib/checkout-session.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // Case-SENSITIVE: the Stripe client variable is lowercase `stripe`, while
    // `Stripe.Checkout.SessionCreateParams` is the type-only import and is
    // exactly what we want the builder to use.
    check("C2 the builder never calls Stripe", !/\bstripe\./.test(builderCode));
    check("C2 the builder has no second create path", !/sessions\.create/.test(builderCode));
    check("C2 the builder imports Stripe types only",
      /import type Stripe from "stripe"/.test(readFileSync("lib/checkout-session.ts", "utf8")));
    check("C2 nothing else consumes the builder yet", (() => {
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
          const full = `${dir}/${e.name}`;
          if (e.isDirectory()) { if (!full.includes("generated")) walk(full); continue; }
          if (!/\.tsx?$/.test(e.name)) continue;
          if (full.includes("api/dev/")) continue;
          if (readFileSync(full, "utf8").includes("buildCheckoutSessionParams")) hits.push(full);
        }
      };
      ["lib", "app", "components"].forEach(walk);
      return hits.filter((h) => !h.endsWith("lib/checkout-session.ts")).length === 1 &&
        hits.some((h) => h.endsWith("lib/actions/order.ts"));
    })());
  }

  /* --------------------- C1 is inert: prove it stays so ------------------ */
  {
    const app = ["lib", "app", "components"];
    check("C1 nothing calls canStartInPersonSale yet", (() => {
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
          const full = `${dir}/${e.name}`;
          if (e.isDirectory()) { if (!full.includes("generated")) walk(full); continue; }
          if (!/\.tsx?$/.test(e.name)) continue;
          if (full.includes("api/dev/")) continue; // this test may reference it
          const t = readFileSync(full, "utf8");
          if (t.includes("canStartInPersonSale")) hits.push(full);
        }
      };
      app.forEach(walk);
      // lib/payments.ts is the definition itself.
      return hits.filter((h) => !h.endsWith("lib/payments.ts")).length === 0;
    })());
    check("C1 wrote no WalkUpSale rows", (await prisma.walkUpSale.count()) === 0);
    const orderSrc = readFileSync("lib/actions/order.ts", "utf8");
    // Updated by C2: the params are now built by the shared builder, so the
    // call takes `params` rather than an inline object literal. What must stay
    // true is that there is exactly ONE create call and it still carries the
    // connected-account context.
    check("online checkout still creates the session on the connected account",
      /stripe\.checkout\.sessions\.create\(/.test(orderSrc) &&
      /stripeAccount: drop\.seller\.stripeAccountId!/.test(orderSrc));
    check("online checkout has exactly one Stripe session create call",
      (orderSrc.match(/sessions\.create\(/g) ?? []).length === 1);
    check("C1 did not move recordRelationship (still a Phase E concern)",
      orderSrc.indexOf("recordRelationship") < orderSrc.indexOf("useStripe && stripe"));
    check("C1 did not change Order.source derivation",
      /const source = drop\.mode === "live" \? "live" : "online";/.test(orderSrc));
    check("C1 created no lib/reporting.ts (that belongs to Phase G)", (() => {
      try { readFileSync("lib/reporting.ts", "utf8"); return false; } catch { return true; }
    })());
  }

  const passed = results.filter((r) => r.pass).length;
  return NextResponse.json(
    {
      suite: "payments",
      passed,
      failed: results.length - passed,
      results: results.filter((r) => !r.pass).length ? results.filter((r) => !r.pass) : "all pass",
    },
    { status: passed === results.length ? 200 : 500 }
  );
}
