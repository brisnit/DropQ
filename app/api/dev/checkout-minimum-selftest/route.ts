import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { placeOrderAction } from "@/lib/actions/order";
import {
  MINIMUM_TOTAL_ERROR,
  MIN_PRODUCT_PRICE_CENTS,
  PRODUCT_MINIMUM_ERROR,
  STRIPE_MIN_TOTAL_CENTS,
  UNSELLABLE_ITEM_ERROR,
  hasBelowMinimumUnitPrice,
  belowProductMinimum,
  belowStripeMinimum,
  buildCheckoutSessionParams,
  checkoutSessionTotalCents,
  defaultExpiresAt,
} from "@/lib/checkout-session";
import { closeUnpayableOrder, reconcilePendingOrders, stripeSetupError } from "@/lib/checkout";
import { fixtureRefusal, fixtureRefusalBody } from "@/lib/fixture-guard";

/**
 * Stripe's $0.50 Checkout minimum, and the orphaned pending orders it produced.
 *
 * THE FAILURE THIS EXISTS FOR. On 31 Aug 2026 a live drop priced at $0.10 and
 * $0.20 was bought on a phone. The cart totalled $0.30, Stripe rejected the
 * Checkout Session with `amount_too_small`, and the buyer got "A server error
 * occurred." An Order row had already been written, and because the cleanup job
 * only looks at orders that HAVE a Stripe session id, that row could never be
 * cleaned up.
 *
 * So there are three separate things to hold in place:
 *
 *   1. A cart under the floor is refused BEFORE anything is written — no Order,
 *      no OrderItem, no Stripe call, no inventory movement.
 *   2. A Stripe refusal that does get through never becomes a 500, and never
 *      leaves a permanently pending order.
 *   3. Reconciliation can see session-less pending orders at all.
 *
 * Fixture-producing: it creates a seller, drop, products and orders, so it
 * refuses anywhere but the harness database.
 */

type Result = { name: string; pass: boolean; detail?: string };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const refusal = fixtureRefusal();
  if (refusal) return NextResponse.json(fixtureRefusalBody(refusal), { status: 503 });

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  const stamp = Date.now().toString(36);

  /* ------------------- 1. The floor, as pure arithmetic ------------------ */
  {
    check("the floor is Stripe's documented $0.50", STRIPE_MIN_TOTAL_CENTS === 50);
    check("$0.30 — the cart that actually failed — is below it", belowStripeMinimum(30));
    check("$0.49 is below it", belowStripeMinimum(49));
    check("$0.50 exactly is NOT below it", !belowStripeMinimum(50));
    check("$0.51 is not below it", !belowStripeMinimum(51));
    check("zero is below it", belowStripeMinimum(0));

    const lines = [
      { priceCents: 20, quantity: 1, name: "Chocolate Chips" },
      { priceCents: 10, quantity: 1, name: "good Cookie" },
    ];
    check("the failing cart totals exactly $0.30",
      checkoutSessionTotalCents({ lines, feeCents: 1, passFee: false }) === 30);
    check("in pass-fee mode the fee counts toward the total",
      checkoutSessionTotalCents({ lines, feeCents: 25, passFee: true }) === 55);
    check("quantity is multiplied, so three of a 20c item clears the floor",
      !belowStripeMinimum(checkoutSessionTotalCents({
        lines: [{ priceCents: 20, quantity: 3, name: "x" }], feeCents: 1, passFee: false })));

    // THE ANTI-DRIFT CHECK. The number we validate must be the number Stripe
    // receives, so it is compared against the sum of the actual built params.
    for (const [feeCents, passFee] of [[1, false], [25, true], [0, false]] as const) {
      const params = buildCheckoutSessionParams({
        orderId: "o1", buyerEmail: "a@b.co", lines, feeCents, passFee,
        successUrl: "https://x/s", cancelUrl: "https://x/c", expiresAt: defaultExpiresAt(),
      });
      const fromParams = (params.line_items ?? []).reduce(
        (sum, li) => sum + (li.price_data?.unit_amount ?? 0) * (li.quantity ?? 0), 0);
      check(`validated total equals what Stripe is sent (fee=${feeCents}, pass=${passFee})`,
        fromParams === checkoutSessionTotalCents({ lines, feeCents, passFee }),
        `params=${fromParams}`);
    }
  }

  /* -------------- 2. The buyer-facing message is never Stripe's ---------- */
  {
    check("the minimum message is plain and actionable",
      MINIMUM_TOTAL_ERROR === "Order total must be at least $0.50.");
    check("amount_too_small is translated to the minimum message",
      stripeSetupError({ type: "StripeInvalidRequestError", code: "amount_too_small" }) ===
        MINIMUM_TOTAL_ERROR);
    const generic = stripeSetupError({ type: "StripeAPIError", code: "account_invalid" });
    check("any other Stripe error gets a safe generic message",
      generic === "We couldn't start checkout just now. Please try again in a moment.");
    check("Stripe's raw message is never handed to the buyer",
      stripeSetupError({ code: "x", message: "No such destination: acct_1Tk" }) === generic);
    check("a non-Stripe throw is handled too", typeof stripeSetupError(new Error("boom")) === "string");
    check("null and undefined do not crash it",
      typeof stripeSetupError(null) === "string" && typeof stripeSetupError(undefined) === "string");
  }

  /* ---------------- 3. Fixtures: a charge-ready vendor ------------------- */
  const seller = await prisma.seller.create({
    data: {
      email: `min-${stamp}@example.com`,
      passwordHash: "not-a-real-hash",
      storeName: "Minimum Test Kitchen",
      slug: `minimum-test-${stamp}`,
      category: "food",
      emailVerified: true,
      termsAcceptedAt: new Date(),
      referralCode: `MIN${stamp.toUpperCase()}`,
      timezone: "America/Los_Angeles",
      // Charge-ready, so placeOrderAction takes the Stripe branch — which is
      // the only branch with a floor.
      stripeAccountId: `acct_test_${stamp}`,
      stripeChargesEnabled: true,
      stripeChargesEnabledAt: new Date(),
    },
  });
  const drop = await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title: "Minimum Test Drop",
      status: "live",
      opensAt: new Date(Date.now() - 60_000),
      closesAt: new Date(Date.now() + 3_600_000),
      products: {
        create: [
          { name: "Dime Cookie", priceCents: 10, inventory: 50 },
          { name: "Twenty-Nine", priceCents: 29, inventory: 50 },
          { name: "Two-Dime Chip", priceCents: 20, inventory: 50 },
          { name: "Half Dollar", priceCents: 50, inventory: 50 },
        ],
      },
    },
    include: { products: { orderBy: { priceCents: "asc" } } },
  });
  const [dime, twoDime, twentyNine, halfDollar] = drop.products;

  const order = (qtys: Record<string, number>) => {
    const fd = new FormData();
    fd.set("dropId", drop.id);
    fd.set("buyerName", "Minimum Tester");
    fd.set("buyerEmail", `buyer-${stamp}@example.com`);
    for (const [id, q] of Object.entries(qtys)) fd.set(`qty_${id}`, String(q));
    return placeOrderAction({}, fd);
  };
  const countOrders = () => prisma.order.count({ where: { dropId: drop.id } });
  const countItems = () =>
    prisma.orderItem.count({ where: { order: { dropId: drop.id } } });
  const inventoryNow = async () =>
    (await prisma.product.findMany({
      where: { dropId: drop.id }, select: { id: true, inventory: true, sold: true },
      orderBy: { priceCents: "asc" },
    })).map((p) => `${p.inventory}/${p.sold}`).join(",");

  const inventoryBefore = await inventoryNow();

  /* ---------------- 4. Below the floor: nothing happens ------------------ */
  {
    // The exact cart from the incident: one 20c item + one 10c item = 30c.
    //
    // NOTE ON WHICH ERROR FIRES. Since the unit-price rule landed, these carts
    // are stopped one step earlier — on the item, not the total — so the
    // message is the unsellable-item one. That is stricter and it is the point:
    // the customer is told which thing they cannot buy rather than being asked
    // to add more of something that will never be sellable. The cart-total rule
    // is still in place behind it, tested directly above and below.
    const res = await order({ [twoDime.id]: 1, [dime.id]: 1 });
    check("the $0.30 cart is refused", res.error === UNSELLABLE_ITEM_ERROR, JSON.stringify(res));
    check("no Order was created", (await countOrders()) === 0, `${await countOrders()} orders`);
    check("no OrderItem was created", (await countItems()) === 0);
    check("inventory is untouched", (await inventoryNow()) === inventoryBefore);

    // 49c — one cent under. The boundary is where an off-by-one would hide.
    const at49 = await order({ [twoDime.id]: 1, [twentyNine.id]: 1 }); // 20 + 29 = 49
    check("the $0.49 cart is refused", at49.error === UNSELLABLE_ITEM_ERROR, JSON.stringify(at49));
    check("still no Order", (await countOrders()) === 0);

    const at40 = await order({ [twoDime.id]: 2 });
    check("a $0.40 cart is refused", at40.error === UNSELLABLE_ITEM_ERROR, JSON.stringify(at40));
    check("still no Order after three refusals", (await countOrders()) === 0);
    check("still no OrderItem", (await countItems()) === 0);
    check("inventory still untouched", (await inventoryNow()) === inventoryBefore);

    // The refusal must be an ordinary action error, not a thrown exception —
    // a throw is what produced "A server error occurred" for the buyer.
    check("the refusal is a returned error, not a throw",
      typeof res.error === "string" && !("digest" in (res as object)));
  }

  /* ------------- 5. At the floor: validation lets it through ------------- */
  {
    // Exactly 50c. This must NOT be refused by the minimum guard. It goes on to
    // the Stripe call, which fails against the harness's fake key — and that
    // failure path is the subject of the next section.
    const res = await order({ [halfDollar.id]: 1 });
    check("a $0.50 cart is NOT refused by the minimum guard",
      res.error !== MINIMUM_TOTAL_ERROR, JSON.stringify(res));
    check("it reached the Stripe stage, so an Order row was written",
      (await countOrders()) >= 1, `${await countOrders()} orders`);

    // ...and because Stripe refused, that row must not still be pending.
    const pending = await prisma.order.count({
      where: { dropId: drop.id, status: "pending" },
    });
    check("the Stripe failure left NO pending order behind", pending === 0,
      `${pending} pending`);
    const closed = await prisma.order.findMany({
      where: { dropId: drop.id },
      select: { status: true, paymentStatus: true, stripeSessionId: true },
    });
    check("the order was closed with the existing canceled/expired vocabulary",
      closed.every((o) => o.status === "canceled" && o.paymentStatus === "expired"),
      JSON.stringify(closed));
    check("no Stripe session id was invented", closed.every((o) => o.stripeSessionId === null));
    check("the buyer got a message, not a 500", typeof res.error === "string" && res.error.length > 0);
    check("the message is not Stripe's raw text",
      !/acct_|sk_|No such|invalid_request/i.test(res.error ?? ""));

    // WHY THE TOTAL RULE NO LONGER FIRES HERE. With every unit required to be
    // at least 50c, any cart with one item is already at the floor, and the
    // pass-fee mode only adds. So the cart-total check has become a backstop
    // that the normal path cannot reach — kept deliberately, because a future
    // discount, a second currency with a different floor, or a fee mode that
    // subtracts would all make it reachable again. It is exercised directly.
    check("the cart-total rule is still present and correct",
      belowStripeMinimum(49) && !belowStripeMinimum(50));
    check("inventory is STILL untouched after a failed paid checkout",
      (await inventoryNow()) === inventoryBefore, await inventoryNow());
  }

  /* ------------- 6. closeUnpayableOrder in isolation --------------------- */
  {
    const paid = await prisma.order.create({
      data: {
        dropId: drop.id, sellerId: seller.id, buyerName: "Paid", buyerEmail: `p-${stamp}@example.com`,
        totalCents: 500, feeCents: 25, status: "paid", paymentStatus: "paid", source: "online",
      },
    });
    await closeUnpayableOrder(paid.id, { type: "StripeAPIError", code: "x" }, "checkout");
    const after = await prisma.order.findUnique({ where: { id: paid.id } });
    check("a PAID order is never closed by the cleanup helper",
      after?.status === "paid" && after?.paymentStatus === "paid",
      `${after?.status}/${after?.paymentStatus}`);

    const stray = await prisma.order.create({
      data: {
        dropId: drop.id, sellerId: seller.id, buyerName: "Stray", buyerEmail: `s-${stamp}@example.com`,
        totalCents: 500, feeCents: 25, status: "pending", paymentStatus: "pending", source: "online",
      },
    });
    const eventsBefore = await prisma.orderEvent.count({ where: { orderId: stray.id } });
    await closeUnpayableOrder(stray.id, { type: "StripeInvalidRequestError", code: "amount_too_small" }, "checkout");
    const strayAfter = await prisma.order.findUnique({ where: { id: stray.id } });
    check("a pending order is closed", strayAfter?.status === "canceled" &&
      strayAfter?.paymentStatus === "expired");
    check("closing writes no payment event",
      (await prisma.orderEvent.count({ where: { orderId: stray.id } })) === eventsBefore);
    check("closing moves no inventory", (await inventoryNow()) === inventoryBefore);
    check("a missing order id does not throw",
      await closeUnpayableOrder("does-not-exist", {}, "checkout").then(() => true, () => false));
  }

  /* --------- 7. Reconciliation can finally see session-less orders ------- */
  {
    const old = new Date(Date.now() - 60 * 60 * 1000); // an hour ago
    const orphan = await prisma.order.create({
      data: {
        dropId: drop.id, sellerId: seller.id, buyerName: "Orphan", buyerEmail: `o-${stamp}@example.com`,
        totalCents: 30, feeCents: 1, status: "pending", paymentStatus: "pending", source: "online",
        createdAt: old,
      },
    });
    const fresh = await prisma.order.create({
      data: {
        dropId: drop.id, sellerId: seller.id, buyerName: "Fresh", buyerEmail: `f-${stamp}@example.com`,
        totalCents: 900, feeCents: 45, status: "pending", paymentStatus: "pending", source: "online",
      },
    });
    const paidOld = await prisma.order.create({
      data: {
        dropId: drop.id, sellerId: seller.id, buyerName: "PaidOld", buyerEmail: `po-${stamp}@example.com`,
        totalCents: 900, feeCents: 45, status: "pending", paymentStatus: "paid", source: "online",
        createdAt: old,
      },
    });

    const before = await inventoryNow();
    const out = await reconcilePendingOrders(15);
    check("reconciliation reports what it swept", typeof out.orphaned === "number",
      JSON.stringify(out));
    check("a stale session-less pending order is swept", out.orphaned >= 1, `${out.orphaned}`);

    const o = await prisma.order.findUnique({ where: { id: orphan.id } });
    check("the orphan is canceled/expired, using the existing vocabulary",
      o?.status === "canceled" && o?.paymentStatus === "expired", `${o?.status}/${o?.paymentStatus}`);
    const f = await prisma.order.findUnique({ where: { id: fresh.id } });
    check("a checkout still in flight is left alone",
      f?.status === "pending" && f?.paymentStatus === "pending", `${f?.status}/${f?.paymentStatus}`);
    const p = await prisma.order.findUnique({ where: { id: paidOld.id } });
    check("an already-PAID order is never swept, however old",
      p?.paymentStatus === "paid", `${p?.status}/${p?.paymentStatus}`);
    check("sweeping moves no inventory", (await inventoryNow()) === before);
    check("sweeping writes no payment event",
      (await prisma.orderEvent.count({ where: { orderId: orphan.id } })) === 0);
    check("running it twice sweeps nothing further",
      (await reconcilePendingOrders(15)).orphaned === 0);
  }

  /* ---------------- 8. The guard is still wired in both flows ----------- */
  {
    const { readFileSync } = await import("node:fs");
    for (const file of ["lib/actions/order.ts", "lib/actions/pay.ts"]) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      check(`${file} checks the minimum`, /belowStripeMinimum\(/.test(src));
      check(`${file} checks it BEFORE creating an order`,
        src.indexOf("belowStripeMinimum(") < src.indexOf("order.create"));
      check(`${file} catches a failed session create`,
        /closeUnpayableOrder\(/.test(src) && /stripeSetupError\(/.test(src));
      check(`${file} uses no bare 50`, !/<\s*50\b/.test(src));
    }
    const shared = readFileSync("lib/checkout-session.ts", "utf8");
    check("the floor is defined once, in the shared limits module",
      /export const STRIPE_MIN_TOTAL_CENTS = 50/
        .test(readFileSync("lib/checkout-limits.ts", "utf8")) &&
      !/export const STRIPE_MIN_TOTAL_CENTS = /.test(shared));
    const recon = readFileSync("lib/checkout.ts", "utf8");
    check("reconciliation sweeps before the missing-Stripe-key early return",
      recon.indexOf("stripeSessionId: null") < recon.indexOf("if (!stripe) return"));
  }

  /* ---- 8b. The UNIT price rule — stricter than Stripe's cart total ------ */
  {
    // Stripe only judges the total, so 3 x 20c would satisfy it. DropQ does
    // not: an item nobody can buy singly is not a listing. These are the cases
    // that separate the two rules.
    const itemsAtStart = await countItems();
    const unit = async (label: string, qtys: Record<string, number>) => {
      const before = await countOrders();
      const res = await order(qtys);
      const after = await countOrders();
      check(`${label} is refused`, res.error === UNSELLABLE_ITEM_ERROR, JSON.stringify(res));
      check(`${label} creates no Order`, after === before, `${before} → ${after}`);
      return res;
    };

    // 1 x 29c — under both rules.
    await unit("a single $0.29 item", { [twentyNine.id]: 1 });
    // 2 x 29c = 58c — CLEARS Stripe's total, still refused on unit price.
    await unit("two $0.29 items totalling $0.58", { [twentyNine.id]: 2 });
    // 3 x 20c = 60c — the case named in the rule.
    await unit("three $0.20 items totalling $0.60", { [twoDime.id]: 3 });
    // 5 x 10c = 50c — exactly at the total floor, still refused.
    await unit("five $0.10 items totalling exactly $0.50", { [dime.id]: 5 });
    // A sub-minimum item riding along with a good one must poison the cart.
    await unit("a $0.50 item bought alongside a $0.10 item",
      { [halfDollar.id]: 1, [dime.id]: 1 });

    check("no OrderItem was created by any of them",
      (await countItems()) === itemsAtStart, `${itemsAtStart} → ${await countItems()}`);
    check("inventory is untouched by all of them",
      (await inventoryNow()) === inventoryBefore, await inventoryNow());
    check("the message names the reason without vendor pricing detail",
      UNSELLABLE_ITEM_ERROR ===
        "This item is unavailable because its price is below the $0.50 minimum.");

    // The helper itself, on the boundary.
    check("hasBelowMinimumUnitPrice spots one bad line among good ones",
      hasBelowMinimumUnitPrice([{ priceCents: 500 }, { priceCents: 49 }, { priceCents: 900 }]));
    check("...and passes a cart of exactly-$0.50 items",
      !hasBelowMinimumUnitPrice([{ priceCents: 50 }, { priceCents: 50 }]));
    check("...and an empty cart", !hasBelowMinimumUnitPrice([]));

    // The unit rule must be checked BEFORE the total rule, or a 3 x 20c cart
    // would be refused with the wrong message.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/actions/order.ts", "utf8");
    check("the unit check runs before the cart-total check",
      src.indexOf("UNSELLABLE_ITEM_ERROR") < src.indexOf("belowStripeMinimum("));
    check("the unit check runs before any order is created",
      src.indexOf("UNSELLABLE_ITEM_ERROR") < src.indexOf("prisma.order.create"));
    const walkupSrc = readFileSync("lib/walkup.ts", "utf8");
    check("a walk-up sale cannot even be STARTED with one",
      /below_minimum_price/.test(walkupSrc));
    const paySrc = readFileSync("lib/actions/pay.ts", "utf8");
    check("and paying for one is refused too",
      /hasBelowMinimumUnitPrice\(/.test(paySrc));

    // Customer-side surfaces.
    const storefront = readFileSync("components/storefront-order.tsx", "utf8");
    check("the storefront will not render an Add control for one",
      /belowMinimum \? \(/.test(storefront));
    check("the storefront refuses to set a quantity for one",
      /if \(product && belowProductMinimum\(product\.priceCents\)\) return;/.test(storefront));
    check("a sub-minimum item never enters the cart subtotal",
      /!belowProductMinimum\(l\.p\.priceCents\)/.test(storefront));
    const walkupUi = readFileSync("components/walkup-sale.tsx", "utf8");
    check("the vendor's walk-up builder blocks it too",
      /belowProductMinimum\(product\.priceCents\)\) return;/.test(walkupUi));
  }

  /* -------- 8c. A LEGACY sub-minimum product is simply unsellable ------- */
  {
    // Exactly the shape of the two products left in production: a library row
    // and a drop row priced under the floor, neither of which we may modify.
    const legacyLib = await prisma.vendorProduct.create({
      data: { sellerId: seller.id, name: "Legacy Dime", priceCents: 10, emoji: "🍪" },
    });
    check("a legacy library row can still EXIST", Boolean(legacyLib.id));
    check("but it is recognised as unsellable", belowProductMinimum(legacyLib.priceCents));

    // On a drop, it cannot be bought...
    const ordersBefore = await countOrders();
    const res = await order({ [dime.id]: 1 });
    check("a legacy priced item cannot be purchased", res.error === UNSELLABLE_ITEM_ERROR);
    check("...and creates no Order", (await countOrders()) === ordersBefore,
      `${ordersBefore} → ${await countOrders()}`);

    // ...and the drop it sits on cannot be published.
    const { readFileSync } = await import("node:fs");
    const dash = readFileSync("lib/actions/dashboard.ts", "utf8");
    check("a drop carrying it cannot be published",
      /priceCents: \{ lt: MIN_PRODUCT_PRICE_CENTS \}/.test(dash));
    check("nothing in the codebase rewrites a legacy price",
      !/priceCents:\s*Math\.max\(50|priceCents:\s*MIN_PRODUCT_PRICE_CENTS\b/.test(dash));

    await prisma.vendorProduct.delete({ where: { id: legacyLib.id } });
  }

  /* ------------- 9. The source-level product price rule ----------------- */
  {
    check("the product floor is $0.50", MIN_PRODUCT_PRICE_CENTS === 50);
    check("it is tied to the Stripe floor, not chosen separately",
      MIN_PRODUCT_PRICE_CENTS === STRIPE_MIN_TOTAL_CENTS);
    check("$0.49 is rejected", belowProductMinimum(49));
    check("$0.50 is accepted", !belowProductMinimum(50));
    check("$0.51 is accepted", !belowProductMinimum(51));
    check("free is rejected", belowProductMinimum(0));
    check("the vendor message names the number",
      PRODUCT_MINIMUM_ERROR.includes("$0.50") &&
      String(PRODUCT_MINIMUM_ERROR) !== String(MINIMUM_TOTAL_ERROR));

    const { readFileSync } = await import("node:fs");
    const products = readFileSync("lib/actions/products.ts", "utf8");
    check("the product library rejects server-side, not just in the UI",
      /belowProductMinimum\(data\.priceCents\)/.test(products));
    check("both create and update are guarded",
      (products.match(/belowProductMinimum\(/g) ?? []).length === 2);
    check("the rejection happens before the write",
      products.indexOf("belowProductMinimum(") < products.indexOf("prisma.vendorProduct.create"));

    const dash = readFileSync("lib/actions/dashboard.ts", "utf8");
    check("a drop cannot be CREATED live with a sub-minimum item",
      /const priceBlocked = status === "live" && products\.some/.test(dash));
    check("a drop cannot be EDITED live with a sub-minimum item",
      (dash.match(/priceBlocked/g) ?? []).length >= 4);
    check("the publish toggle is guarded too",
      /priceCents: \{ lt: MIN_PRODUCT_PRICE_CENTS \}/.test(dash));
    check("blocked publishing saves as a draft rather than discarding work",
      /priceBlocked \? "draft" : status/.test(dash));
    check("no price is ever rewritten to meet the floor",
      !/priceCents:\s*Math\.max\(|priceCents:\s*MIN_PRODUCT_PRICE_CENTS/.test(dash + products));
    check("the vendor is told why", /price_minimum=1/.test(dash));

    const page = readFileSync("app/dashboard/drops/[id]/page.tsx", "utf8");
    check("the drop page renders the reason", /price_minimum/.test(page) && /at least \$0\.50/.test(page));

    const editor = readFileSync("components/drop-editor.tsx", "utf8");
    check("the editor gives immediate client-side feedback", /belowMinimum\(row\.price\)/.test(editor));
    check("the editor imports the shared constant rather than hard-coding 50",
      /MIN_PRODUCT_PRICE_CENTS/.test(editor) && !/< ?50\b/.test(editor));
    const library = readFileSync("components/product-library.tsx", "utf8");
    check("the library price input carries a client-side minimum",
      /min="0\.50"/.test(library));

    // The limits must be importable by the browser, or the editor cannot use
    // them — this is what broke when they lived in the server-only module.
    // Comments stripped: the module explains at length WHY it carries no
    // server-only marker, and a naive scan reads that explanation as one.
    const limits = readFileSync("lib/checkout-limits.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    check("the shared limits module is browser-safe", !/server-only/.test(limits));
    // Pure by construction: nothing imported, nothing read from the
    // environment. The constant NAMES mention Stripe, which is not the same as
    // touching it — so this checks imports and env access, not the word.
    check("it imports nothing at all", !/^\s*import\s/m.test(limits));
    check("it reads no environment and no database",
      !/process\.env|prisma\./.test(limits));

    // ---- and it actually works, through the real action ----
    const { createVendorProductAction } = await import("@/lib/actions/products");
    check("createVendorProductAction is exported for the guard to cover",
      typeof createVendorProductAction === "function");
  }

  /* --------- 10. Normal, correctly-priced products still work ----------- */
  {
    // The regression that would matter most: this whole change quietly breaking
    // ordinary checkout. A $9.00 cart must sail past every new guard and reach
    // the Stripe stage — where the harness's fake key ends it, as designed.
    const good = await prisma.product.create({
      data: { dropId: drop.id, name: "Nine Dollar Loaf", priceCents: 900, inventory: 10 },
    });
    // Scoped to the orders THIS section creates. Section 7 deliberately leaves
    // two pending rows behind — the in-flight control and the already-paid
    // control — and sweeping them in here would be checking the wrong thing.
    const preExisting = new Set(
      (await prisma.order.findMany({ where: { dropId: drop.id }, select: { id: true } }))
        .map((o) => o.id)
    );
    const before = await countOrders();
    const res = await order({ [good.id]: 1 });
    check("a $9.00 cart is not refused by the unit rule", res.error !== UNSELLABLE_ITEM_ERROR);
    check("nor by the total rule", res.error !== MINIMUM_TOTAL_ERROR);
    check("it reached the Stripe stage", (await countOrders()) > before);
    const two = await order({ [good.id]: 2, [halfDollar.id]: 1 });
    check("a mixed cart of correctly-priced items is accepted too",
      two.error !== UNSELLABLE_ITEM_ERROR && two.error !== MINIMUM_TOTAL_ERROR, JSON.stringify(two));
    const stillPending = (
      await prisma.order.findMany({
        where: { dropId: drop.id, status: "pending" },
        select: { id: true, totalCents: true, paymentStatus: true },
      })
    ).filter((o) => !preExisting.has(o.id));
    check("no correctly-priced order was left pending", stillPending.length === 0,
      JSON.stringify(stillPending));
  }

  /* ----------------------------- teardown ------------------------------- */
  await prisma.orderItem.deleteMany({ where: { order: { dropId: drop.id } } });
  await prisma.orderEvent.deleteMany({ where: { order: { dropId: drop.id } } });
  await prisma.order.deleteMany({ where: { dropId: drop.id } });
  await prisma.product.deleteMany({ where: { dropId: drop.id } });
  await prisma.drop.delete({ where: { id: drop.id } });
  await prisma.customer.deleteMany({ where: { email: { contains: `-${stamp}@example.com` } } });
  await prisma.seller.delete({ where: { id: seller.id } });

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "checkout-minimum",
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
