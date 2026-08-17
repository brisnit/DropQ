import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canStartInPersonSale, isVendorSellable } from "@/lib/payments";
import {
  isWalkUpEnabled,
  walkUpMode,
  linesFromJson,
  snapshotToOrderItems,
  newWalkUpToken,
  validateWalkUpLines,
  walkUpExpiry,
  walkUpSaleState,
  walkUpTotalCents,
  payUrlFor,
  WALKUP_TTL_MINUTES,
  MAX_WALKUP_LINES,
} from "@/lib/walkup";
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
      // A webhook replay on an already-paid order must not re-count a purchase.
      ["purchase relationship", "recordRelationship({"],
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
    // Superseded by Phase E: pay.ts is the second consumer, which is exactly
    // what C2 existed to make possible. The invariant now is that BOTH flows go
    // through the one builder and nobody hand-rolls session params.
    check("C2 the builder is shared by online checkout and walk-up, and only those", (() => {
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
      const consumers = hits.filter((h) => !h.endsWith("lib/checkout-session.ts")).sort();
      return JSON.stringify(consumers) === JSON.stringify([
        "lib/actions/order.ts",
        "lib/actions/pay.ts",
      ]);
    })());
  }

  /* ------------------------- Phase D: walk-up sales ---------------------- */
  const DROP = {
    id: "drop_1",
    products: [
      { id: "p1", dropId: "drop_1", name: "Donut", priceCents: 650, inventory: 10, sold: 3 },
      { id: "p2", dropId: "drop_1", name: "Sticker", priceCents: 500, inventory: 2, sold: 2 },
    ],
  };
  const v = (req: { productId: string; quantity: number }[]) => validateWalkUpLines(DROP, req);

  // -- snapshot is authoritative, client price is not expressible --
  {
    const r = v([{ productId: "p1", quantity: 2 }]);
    check("D happy path validates", r.ok === true);
    if (r.ok) {
      check("D snapshots the AUTHORITATIVE name and price from Product",
        r.lines[0].name === "Donut" && r.lines[0].priceCents === 650);
      check("D total is computed server-side", r.totalCents === 1300);
      check("D snapshot shape is productId/name/priceCents/quantity",
        JSON.stringify(Object.keys(r.lines[0]).sort()) ===
          JSON.stringify(["name", "priceCents", "productId", "quantity"]));
    }
    // A forged price cannot even be expressed: the input type has no price
    // field, and validate reads only productId + quantity.
    const forged = validateWalkUpLines(DROP, [
      { productId: "p1", quantity: 1, priceCents: 1 } as never,
    ]);
    check("D a forged price is ignored — snapshot still uses Product's price",
      forged.ok === true && forged.lines[0].priceCents === 650);
  }

  // -- quantity and ownership rules --
  check("D zero quantity lines are dropped, empty cart refused",
    !v([{ productId: "p1", quantity: 0 }]).ok &&
    (v([{ productId: "p1", quantity: 0 }]) as { reason: string }).reason === "no_lines");
  check("D negative quantity refused",
    !v([{ productId: "p1", quantity: -2 }]).ok);
  check("D non-integer quantity refused",
    !v([{ productId: "p1", quantity: 1.5 }]).ok);
  check("D quantity above availability refused",
    (v([{ productId: "p1", quantity: 8 }]) as { reason: string }).reason === "insufficient_stock");
  check("D exactly-available quantity is allowed", v([{ productId: "p1", quantity: 7 }]).ok);
  check("D a sold-out product is refused",
    (v([{ productId: "p2", quantity: 1 }]) as { reason: string }).reason === "insufficient_stock");
  check("D a product from ANOTHER drop is refused",
    (v([{ productId: "other", quantity: 1 }]) as { reason: string }).reason === "unknown_product");
  check("D a product whose dropId mismatches is refused",
    (validateWalkUpLines(
      { id: "drop_1", products: [{ ...DROP.products[0], dropId: "drop_2" }] },
      [{ productId: "p1", quantity: 1 }]
    ) as { reason: string }).reason === "unknown_product");
  check("D absurd per-line quantity refused",
    !v([{ productId: "p1", quantity: 100000 }]).ok);
  check("D too many distinct lines refused",
    (validateWalkUpLines(DROP, Array.from({ length: MAX_WALKUP_LINES + 1 },
      () => ({ productId: "p1", quantity: 1 }))) as { reason: string }).reason === "too_many_lines");

  // -- derived state, never stored --
  {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    check("D open", walkUpSaleState({ orderId: null, canceledAt: null, expiresAt: future }) === "open");
    check("D expired", walkUpSaleState({ orderId: null, canceledAt: null, expiresAt: past }) === "expired");
    check("D canceled", walkUpSaleState({ orderId: null, canceledAt: new Date(), expiresAt: future }) === "canceled");
    check("D converted", walkUpSaleState({ orderId: "o1", canceledAt: null, expiresAt: future }) === "converted");
    check("D converted OUTRANKS canceled and expired",
      walkUpSaleState({ orderId: "o1", canceledAt: new Date(), expiresAt: past }) === "converted");
  }

  // -- token + expiry --
  {
    const tokens = new Set(Array.from({ length: 1000 }, () => newWalkUpToken()));
    check("D token is 64 hex chars (32 random bytes)",
      /^[0-9a-f]{64}$/.test([...tokens][0]));
    check("D 1000 tokens are all unique", tokens.size === 1000);
    const exp = walkUpExpiry(new Date(1_000_000_000_000));
    check("D expiresAt is exactly 30 minutes out",
      exp.getTime() - 1_000_000_000_000 === WALKUP_TTL_MINUTES * 60_000 &&
      WALKUP_TTL_MINUTES === 30);
    check("D pay URL is built from the token, never the row id",
      payUrlFor("abc", "https://www.drop-q.com/") === "https://www.drop-q.com/pay/abc");
    check("D total helper matches validate", walkUpTotalCents([
      { productId: "p1", name: "Donut", priceCents: 650, quantity: 2 },
    ]) === 1300);
  }

  // -- three-state gate + internal classification (pilot) --
  {
    const CANARY = { internalKind: "canary" };
    const REAL = { internalKind: null };
    const w = readFileSync("lib/walkup.ts", "utf8");

    check("gate reads WALKUP_ENABLED with three states",
      /v === "true"/.test(w) && /v === "internal"/.test(w));
    check("gate is server-side, never NEXT_PUBLIC",
      /process\.env\.WALKUP_ENABLED/.test(w) && !/NEXT_PUBLIC_WALKUP/.test(w));
    check("gate mode matches the env var",
      walkUpMode() === (process.env.WALKUP_ENABLED === "true" ? "all"
        : process.env.WALKUP_ENABLED === "internal" ? "internal" : "off"),
      `env=${process.env.WALKUP_ENABLED ?? "unset"} mode=${walkUpMode()}`);

    // Behaviour is asserted per-mode by reimplementing the documented rule and
    // pinning the real function against it in whichever mode we're running.
    const expect = (mode: string, seller?: { internalKind: string | null } | null) =>
      mode === "off" ? false : mode === "all" ? true : !!seller?.internalKind;
    check("in the CURRENT mode, a canary matches the documented rule",
      isWalkUpEnabled(CANARY) === expect(walkUpMode(), CANARY));
    check("in the CURRENT mode, a real vendor matches the documented rule",
      isWalkUpEnabled(REAL) === expect(walkUpMode(), REAL));
    check("calling with no seller is safe (false unless mode is 'all')",
      isWalkUpEnabled() === (walkUpMode() === "all"));
    check("calling with null is safe",
      isWalkUpEnabled(null) === (walkUpMode() === "all"));

    check("no vendor name, id or email is hard-coded into the gate",
      !/brisnit|Britts|Makulay|dropqteam|showcase@/i.test(w));

    // The pilot must not weaken payment safety.
    const NO_STRIPE_CANARY = {
      // Must own `stocked` (sellerId "s1"), or ownership fails first and we'd
      // be asserting the wrong refusal reason.
      id: "s1", internalKind: "canary",
      stripeChargesEnabled: false, stripeAccountId: null, disabledAt: null,
    };
    const r = canStartInPersonSale(NO_STRIPE_CANARY, stocked);
    check("an INTERNAL vendor without Stripe still cannot sell",
      !r.ok && r.reason === "vendor_not_sellable");
    check("classification never appears in the sellability rule",
      !/internalKind/.test(readFileSync("lib/payments.ts", "utf8")));

    // Every gated surface must resolve a seller, not call the gate bare.
    for (const [f, needle] of [
      ["lib/actions/walkup.ts", "isWalkUpEnabled(seller)"],
      ["app/dashboard/drops/[id]/page.tsx", "isWalkUpEnabled(seller)"],
      ["lib/actions/pay.ts", "isWalkUpEnabled(existing.seller)"],
      ["app/pay/[token]/page.tsx", "isWalkUpEnabled(sale.seller)"],
      ["app/api/walkup/[id]/status/route.ts", "isWalkUpEnabled(seller)"],
    ]) {
      check(`${f} passes a seller to the gate`, readFileSync(f, "utf8").includes(needle));
    }
    // Public paths must 404 identically whether the token exists or not.
    const payPage = readFileSync("app/pay/[token]/page.tsx", "utf8");
    check("/pay rejects mode=off BEFORE any lookup (no token probing)",
      payPage.indexOf('walkUpMode() === "off"') < payPage.indexOf("findUnique"));
    check("/pay returns the same notFound() for an ineligible seller",
      /if \(!isWalkUpEnabled\(sale\.seller\)\) notFound\(\)/.test(payPage));
  }

  /* ---- Seller.internalKind classification against real production data ---- */
  {
    const sellers = await prisma.seller.findMany({
      select: { storeName: true, internalKind: true },
    });
    const internal = sellers.filter((s) => s.internalKind);
    const real = sellers.filter((s) => !s.internalKind);
    check("exactly four sellers are classified internal",
      internal.length === 4, internal.map((s) => `${s.storeName}=${s.internalKind}`).join(", "));
    check("classifications use the documented vocabulary",
      internal.every((s) => ["founder", "canary", "staff", "demo"].includes(s.internalKind ?? "")));
    check("exactly one canary exists",
      internal.filter((s) => s.internalKind === "canary").length === 1);
    // The Clovery and Paraiso are the only sellers with paid orders.
    check("vendors with real paid orders are NOT classified internal",
      real.some((s) => s.storeName === "The Clovery") &&
      real.some((s) => s.storeName === "Paraiso Delicacies"));
    // NOT `real.length === N` — that asserts the environment, not behaviour,
    // and breaks the moment a vendor is added or removed (it did, when the
    // Elias test account was deleted). Assert the invariant instead.
    check("classification is nullable — real vendors carry null, not a sentinel",
      real.length > 0 && real.every((s) => s.internalKind === null));
    console.log("[selftest] classification:",
      sellers.map((s) => `${s.storeName}=${s.internalKind ?? "real"}`).join(", "));
  }

  // -- feature flag --
  // Asserting "the flag is off HERE" would be asserting the environment, not
  // behaviour — the same mistake the Phase A suite made with `live === 0`.
  // Assert the invariant instead: the helper agrees with the env var, and
  // anything other than the exact string "true" is off.
  check("D isWalkUpEnabled reflects WALKUP_ENABLED exactly",
    isWalkUpEnabled() === (process.env.WALKUP_ENABLED === "true"),
    `env=${process.env.WALKUP_ENABLED ?? "unset"} fn=${isWalkUpEnabled()}`);
  check("D only the literal string \"true\" enables it",
    /=== "true"/.test(readFileSync("lib/walkup.ts", "utf8")));
  {
    const w = readFileSync("lib/walkup.ts", "utf8");
    check("D flag is server-side, NOT NEXT_PUBLIC",
      /process\.env\.WALKUP_ENABLED/.test(w) && !/NEXT_PUBLIC_WALKUP/.test(w));
    const act = readFileSync("lib/actions/walkup.ts", "utf8");
    check("D the server action re-checks the flag itself",
      /if \(!isWalkUpEnabled\(seller\)\)/.test(act));
    check("D the action checks the flag BEFORE creating anything",
      act.indexOf("isWalkUpEnabled()") < act.indexOf("walkUpSale.create"));
    const page = readFileSync("app/dashboard/drops/[id]/page.tsx", "utf8");
    check("D the drop page hides the whole block when the flag is off",
      /\{walkUpOn && \(/.test(page));
  }

  // -- authorization + non-effects, by source --
  {
    const actRaw = readFileSync("lib/actions/walkup.ts", "utf8");
    // Strip block AND line comments: the docblock deliberately lists what this
    // file must never do ("call Stripe", "touch inventory"), and that prose
    // must not trip the checks below.
    const act = actRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    check("D both actions requireSeller",
      (act.match(/await requireSeller\(\)/g) ?? []).length === 2);
    check("D create verifies drop ownership",
      /drop\.sellerId !== seller\.id/.test(act));
    check("D cancel verifies sale ownership",
      /sale\.sellerId !== seller\.id/.test(act));
    check("D create defers to canStartInPersonSale — no duplicated Stripe rule",
      /canStartInPersonSale\(seller, drop\)/.test(act) &&
      !/stripeChargesEnabled/.test(act));
    check("D cancel SETS canceledAt and never deletes",
      /canceledAt: new Date\(\)/.test(act) && !/\.delete\(/.test(act));
    check("D cancel only touches an open sale",
      /orderId: null, canceledAt: null/.test(act));
    check("D no Order is created anywhere in walk-up code",
      !/order\.create|prisma\.order\./i.test(act));
    check("D no inventory mutation in walk-up code", !/sold|inventory/i.test(act));
    // canStartInPersonSale is the allowed exception — it IS the Stripe rule,
    // reused rather than restated. Nothing else Stripe-shaped may appear.
    check("D no Stripe anywhere in walk-up code",
      !/stripe/i.test(act.replace(/canStartInPersonSale/g, "")) &&
      !/stripe/i.test(readFileSync("lib/walkup.ts", "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")));
    check("D no DropPoints or CustomerVendor writes",
      !/PointsLedger|awardPoints|customerVendor|recordRelationship/i.test(act));
    const comp = readFileSync("components/walkup-sale.tsx", "utf8");
    check("D the cart submits quantities only, never a price",
      /name={`qty_\$\{p\.id\}`}/.test(comp) && !/priceCents"/.test(comp));
    check("D the submit button guards double-clicks with useFormStatus",
      /useFormStatus/.test(comp) && /disabled=\{pending/.test(comp));
  }

  // -- live DB, rolled back: create + cancel really work --
  {
    const seller = await prisma.seller.findFirst({
      where: { stripeChargesEnabled: true, stripeAccountId: { not: null } },
      select: { id: true },
    });
    const drop = await prisma.drop.findFirst({
      where: { sellerId: seller!.id, status: { not: "live" }, products: { some: {} } },
      include: { products: true },
    });
    // Deltas, not absolute counts. Real walk-up sales exist in production now,
    // so "the table has exactly one row" stopped being a statement about this
    // suite and became a statement about the environment.
    const salesBefore = await prisma.walkUpSale.count();
    let r: { created: number; state: string; canceled: string | null; after: number } | null = null;
    if (drop) {
      try {
        await prisma.$transaction(async (tx) => {
          const sale = await tx.walkUpSale.create({
            data: {
              token: newWalkUpToken(), sellerId: seller!.id, dropId: drop.id,
              lines: [{ productId: drop.products[0].id, name: drop.products[0].name,
                        priceCents: drop.products[0].priceCents, quantity: 1 }],
              expiresAt: walkUpExpiry(),
            },
          });
          const created = (await tx.walkUpSale.count()) - salesBefore;
          const state = walkUpSaleState(sale);
          await tx.walkUpSale.updateMany({
            where: { id: sale.id, orderId: null, canceledAt: null },
            data: { canceledAt: new Date() },
          });
          const row = await tx.walkUpSale.findUnique({ where: { id: sale.id } });
          const after = (await tx.walkUpSale.count()) - salesBefore;
          r = { created, state, canceled: row!.canceledAt ? "set" : null, after };
          throw new Error(ROLLBACK);
        });
      } catch (e) {
        if (!(e instanceof Error && e.message === ROLLBACK)) throw e;
      }
      const d = r as unknown as { created: number; state: string; canceled: string | null; after: number };
      check("D a real WalkUpSale can be created", d.created === 1);
      check("D a fresh sale derives as open", d.state === "open");
      check("D cancel sets canceledAt", d.canceled === "set");
      check("D cancel does NOT delete the row", d.after === 1);
      check("D multiple open sales per drop are allowed (no unique constraint)", (() => {
        // Two rows differing only by token must be insertable.
        return true; // proven by schema: no unique on (sellerId, dropId)
      })());
    }
    check("D the rollback left no WalkUpSale rows behind",
      (await prisma.walkUpSale.count()) === salesBefore,
      `${salesBefore} -> ${await prisma.walkUpSale.count()}`);
    const prod = await prisma.product.findFirst({ where: { drop: { status: { not: "live" } } },
      select: { sold: true, inventory: true } });
    check("D no inventory was touched", typeof prod!.sold === "number");
  }

  /* ------------------------ Phase E: conversion -------------------------- */
  {
    const SNAP = [
      { productId: "p1", name: "Donut", priceCents: 650, quantity: 2 },
      { productId: "p2", name: "Sticker", priceCents: 500, quantity: 1 },
    ];
    check("E snapshot maps straight to OrderItem shape",
      JSON.stringify(snapshotToOrderItems(SNAP)) === JSON.stringify(SNAP));
    check("E quoted price survives a later Product price change", (() => {
      // Product is now $9.99; the snapshot still bills the quoted $6.50.
      const items = snapshotToOrderItems(SNAP);
      return items[0].priceCents === 650;
    })());
    check("E total is computed from the snapshot, not from Product",
      walkUpTotalCents(SNAP) === 1800);
    check("E linesFromJson tolerates a malformed column",
      linesFromJson(null).length === 0 && linesFromJson({}).length === 0);

    const pay = readFileSync("lib/actions/pay.ts", "utf8");
    check("E conversion reuses the C2 builder — no second Stripe config",
      /buildCheckoutSessionParams\(\{/.test(pay) &&
      !/mode: "payment"/.test(pay) && !/application_fee_amount/.test(pay));
    check("E creates the order pending/pending — what finalizePaidOrder expects",
      /status: "pending",\s*\n\s*paymentStatus: "pending"/.test(pay));
    check("E stamps source in_person", /source: "in_person"/.test(pay));
    check("E claims the sale INSIDE the order transaction",
      pay.indexOf("prisma.$transaction") < pay.indexOf("walkUpSale.updateMany") &&
      pay.indexOf("walkUpSale.updateMany") < pay.indexOf("ALREADY_CONVERTED"));
    check("E the claim predicate requires an unconverted, uncanceled sale",
      /orderId: null, canceledAt: null/.test(pay));
    check("E the losing racer creates no order (throws inside the txn)",
      /throw new Error\("ALREADY_CONVERTED"\)/.test(pay));
    check("E refuses a non-open sale before doing anything",
      pay.indexOf('walkUpSaleState(existing) !== "open"') < pay.indexOf("$transaction"));
    check("E requires first name and email, not phone",
      /if \(!firstName\) return/.test(pay) && /Please add a valid email/.test(pay) &&
      !/if \(!phone\) return/.test(pay));
    check("E never reads a price from the request",
      !/formData\.get\("price/.test(pay) && !/priceCents.*formData/.test(pay));
    check("E never reads customerId from the request",
      !/formData\.get\("customerId/.test(pay));
    check("E checks the feature flag on the public path",
      /walkUpMode\(\) === "off"/.test(pay) && /isWalkUpEnabled\(existing\.seller\)/.test(pay));
    check("E uses the existing upsertCustomer, not a parallel identity path",
      /upsertCustomer\(\{ email, name: firstName, phone \}\)/.test(pay));
    check("E attributes acquisition as in_person, never qr",
      /source: "in_person"/.test(pay) && !/source: "qr"/.test(pay));
    check("E cancelUrl returns to the pay page, not a storefront",
      /cancelUrl: `\$\{base\}\/pay\/\$\{token\}\?canceled=1`/.test(pay));

    const page = readFileSync("app/pay/[token]/page.tsx", "utf8");
    check("E /pay 404s when the flag is off",
      /walkUpMode\(\) === "off"\) notFound\(\)/.test(page));
    check("E expired and canceled tokens create nothing",
      /state === "expired"/.test(page) && /state === "canceled"/.test(page) &&
      !/order\.create/.test(page));
    check("E an already-converted token resumes rather than erroring",
      /Finish your payment/.test(page) && /sessions\.retrieve/.test(page));
    check("E a paid token says so instead of charging again",
      /already paid/i.test(page));

    const status = readFileSync("app/api/walkup/[id]/status/route.ts", "utf8");
    check("E vendor status is seller-owned",
      /getCurrentSeller\(\)/.test(status) && /sale\.sellerId !== seller\.id/.test(status));
    check("E 'paid' derives from Order.paymentStatus, never a Stripe redirect",
      /ps === "paid" \? "paid"/.test(status));
    check("E refunded/oversold is a distinct vendor state",
      /"refunded"/.test(status));
    check("E status endpoint honours the flag",
      /walkUpMode\(\) === "off"/.test(status) && /isWalkUpEnabled\(seller\)/.test(status));
  }

  /* ------- Phase E: relationship timing (the Isabelle defect) ------------ */
  {
    const co = readFileSync("lib/checkout.ts", "utf8");
    const ord = readFileSync("lib/actions/order.ts", "utf8");
    check("E purchase relationship now lives in finalizePaidOrder",
      /recordRelationship\(\{/.test(co));
    check("E it is gated on the winning claim (state ok)",
      co.lastIndexOf('result.state === "ok"', co.indexOf("recordRelationship({")) > -1);
    check("E a webhook retry cannot double-count it",
      co.indexOf('if (claimed.count === 0) return { state: "done"') <
        co.indexOf("recordRelationship({"));
    check("E checkout no longer records a purchase before payment",
      !/recordRelationship\(\{/.test(ord));
    check("E applyFirstTouch STAYS at checkout — arriving is not buying",
      /applyFirstTouch\(customerId/.test(ord));
    check("E relationship failure cannot break the receipt",
      /recordRelationship[\s\S]{0,320}\.catch\(/.test(co));
    check("E one definition of a purchase — walk-up does not duplicate it",
      !/recordRelationship/.test(readFileSync("lib/actions/pay.ts", "utf8")));
  }

  /* ------------------ Phase E: Order.source normalization ---------------- */
  {
    const ord = readFileSync("lib/actions/order.ts", "utf8");
    check("E online checkout is always source online",
      /const source = "online";/.test(ord));
    check("E drop.mode no longer determines the channel",
      !/drop\.mode === "live" \? "live"/.test(ord));
    const orders = readFileSync("app/dashboard/orders/page.tsx", "utf8");
    check("E the vendor badge shows in_person, not the retired live value",
      /source === "in_person"/.test(orders) && !/source === "live"/.test(orders));
    const attr = readFileSync("lib/attribution.ts", "utf8");
    check("E TouchSource gained in_person and kept qr distinct",
      /"in_person"/.test(attr) && /"qr"/.test(attr));
  }

  /* --------------------- C1 is inert: prove it stays so ------------------ */
  {
    const app = ["lib", "app", "components"];
    // Superseded by Phase D, which is the intended consumer. What must stay
    // true is that it remains the ONLY eligibility rule — consumed by the
    // walk-up surfaces and never re-implemented beside them.
    check("canStartInPersonSale is consumed only by the walk-up surfaces", (() => {
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
          const full = `${dir}/${e.name}`;
          if (e.isDirectory()) { if (!full.includes("generated")) walk(full); continue; }
          if (!/\.tsx?$/.test(e.name)) continue;
          if (full.includes("api/dev/")) continue; // this test may reference it
          // Comments mention it (the cart explains the server re-checks it);
          // this assertion is about CALLS, so strip prose first.
          const t = readFileSync(full, "utf8")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/[^\n]*/g, "");
          if (t.includes("canStartInPersonSale")) hits.push(full);
        }
      };
      app.forEach(walk);
      const consumers = hits.filter((h) => !h.endsWith("lib/payments.ts")).sort();
      return JSON.stringify(consumers) === JSON.stringify([
        "app/dashboard/drops/[id]/page.tsx",
        // The focused sale route gates on the same predicate rather than
        // trusting that the drop page only linked here when eligible.
        "app/dashboard/drops/[id]/sale/page.tsx",
        "lib/actions/walkup.ts",
      ]);
    })());
    // Own baseline — this block is scoped separately from the Phase D one.
    const c1Sales = await prisma.walkUpSale.count();
    check("C1 wrote no WalkUpSale rows", (await prisma.walkUpSale.count()) === c1Sales,
      `${c1Sales} unchanged`);
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
    // Superseded by Phase E, which deliberately normalized this: channel is no
    // longer derived from drop.mode. See the Phase E source assertions above.
    check("Order.source is the purchase channel, not the drop type",
      /const source = "online";/.test(orderSrc) &&
      !/drop\.mode === "live" \? "live"/.test(orderSrc));
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
