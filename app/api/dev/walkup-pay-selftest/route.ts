import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isStripeEnabled } from "@/lib/stripe";
import { payWalkUpSaleAction } from "@/lib/actions/pay";
import { newWalkUpToken, walkUpExpiry } from "@/lib/walkup";
import { fixtureRefusal, fixtureRefusalBody } from "@/lib/fixture-guard";

/**
 * Development-only regression test that EXECUTES `payWalkUpSaleAction` against
 * the real database.
 *
 * Why this exists. Phase E shipped with:
 *
 *     include: { seller: true, drop: { select: { id: true, slug: true } } as never }
 *
 * `Drop` has no `slug`, so Prisma rejected the query at runtime and the action
 * could never take a payment. The `as never` hid it from `tsc`, and every other
 * test covers pure helpers — nothing ran this function against a database, so
 * `npm run build`, `tsc` and 181 passing payment checks all stayed green while
 * walk-up payments were completely broken in production.
 *
 * The one assertion that matters is therefore **"no PrismaClientValidationError"**.
 * It needs no Stripe key, because the query runs before the Stripe guard — so
 * any future schema/query drift in this path fails CI even in a bare
 * environment. With a key present the test goes further and pins the whole
 * conversion.
 *
 * ⚠️ Not a rolled-back transaction. The action uses the module-level `prisma`
 * singleton rather than an injected client, so a wrapper transaction would not
 * enlist. Instead: create fixtures → execute → assert → delete in a `finally` →
 * **assert every table count is back to baseline**. A cleanup miss fails the
 * test rather than silently leaking rows.
 *
 * ⚠️ No real charge is possible. The fixture vendor's `stripeAccountId` is
 * fake, and the run stops at Stripe's API boundary — which is *after* the Order
 * and the walk-up conversion, exactly the state we want to inspect.
 */

/** Explicit counters — no dynamic model lookup, so this file needs no casts. */
const TRACKED: Record<string, () => Promise<number>> = {
  order: () => prisma.order.count(),
  orderItem: () => prisma.orderItem.count(),
  orderEvent: () => prisma.orderEvent.count(),
  customer: () => prisma.customer.count(),
  customerVendor: () => prisma.customerVendor.count(),
  pointsLedger: () => prisma.pointsLedger.count(),
  walkUpSale: () => prisma.walkUpSale.count(),
  product: () => prisma.product.count(),
  drop: () => prisma.drop.count(),
  seller: () => prisma.seller.count(),
};

type Check = { name: string; pass: boolean; detail?: string };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  // This suite creates application records as fixtures. It runs only against
  // the isolated harness database — never production, never preview, never a
  // developer's own database. See lib/fixture-guard.ts for why teardown is not
  // considered sufficient.
  const refusal = fixtureRefusal();
  if (refusal) {
    return NextResponse.json(fixtureRefusalBody(refusal), { status: 503 });
  }

  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail });

  const baseline: Record<string, number> = {};
  for (const [m, count] of Object.entries(TRACKED)) baseline[m] = await count();

  // Unique per run so a crashed earlier run can never collide with this one.
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `walkup-pay-selftest-${stamp}@example.com`;

  const created: { seller?: string; drop?: string; product?: string; sale?: string; order?: string; customer?: string } = {};
  const prevFlag = process.env.WALKUP_ENABLED;

  try {
    // ---- Fixtures ----------------------------------------------------------
    // `internalKind` is set so `isWalkUpEnabled` passes in "internal" mode;
    // `stripeAccountId` is deliberately not a real connected account.
    const seller = await prisma.seller.create({
      data: {
        email: `seller-${stamp}@example.com`,
        slug: `walkup-selftest-${stamp}`,
        storeName: "Walk-Up Selftest Vendor",
        passwordHash: "selftest-not-a-real-hash",
        internalKind: "selftest",
        feeMode: "absorb",
        stripeAccountId: `acct_selftest_${stamp}`,
        stripeChargesEnabled: true,
      },
      select: { id: true },
    });
    created.seller = seller.id;

    const drop = await prisma.drop.create({
      data: {
        sellerId: seller.id,
        title: "Walk-Up Selftest Drop",
        status: "draft",
        mode: "preorder",
        fulfillment: "pickup",
        products: {
          create: [{ name: "Selftest Cookie", priceCents: 100, emoji: "🍪", inventory: 5, sold: 0, sortOrder: 0 }],
        },
      },
      include: { products: { select: { id: true } } },
    });
    created.drop = drop.id;
    created.product = drop.products[0].id;

    const token = newWalkUpToken();
    const sale = await prisma.walkUpSale.create({
      data: {
        token,
        sellerId: seller.id,
        dropId: drop.id,
        lines: [{ productId: drop.products[0].id, name: "Selftest Cookie", priceCents: 100, quantity: 1 }],
        expiresAt: walkUpExpiry(),
      },
      select: { id: true },
    });
    created.sale = sale.id;

    // ---- Execute the real action ------------------------------------------
    process.env.WALKUP_ENABLED = "internal";
    const fd = new FormData();
    fd.set("token", token);
    fd.set("firstName", "Selftest");
    fd.set("email", email);

    let thrown: unknown = null;
    let returned: { error?: string } | undefined;
    try {
      returned = await payWalkUpSaleAction({}, fd);
    } catch (e) {
      thrown = e;
    }

    const asText = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown ?? "");
    const prismaInvalid = /PrismaClientValidationError|Unknown field|Invalid `prisma\./.test(asText);

    // THE regression assertion. This is what the shipped bug would trip.
    check("action does not fail with a Prisma validation error",
      !prismaInvalid, prismaInvalid ? asText.slice(0, 200) : "clean");
    check("action got past the walkUpSale lookup",
      returned?.error !== "This payment link isn't valid.", returned?.error ?? "no early return");

    // ---- Conversion assertions (need a Stripe key to be reachable) ---------
    const order = await prisma.order.findFirst({
      where: { sellerId: seller.id },
      include: { items: true, events: true },
    });
    if (order) created.order = order.id;

    if (!isStripeEnabled()) {
      check("conversion assertions reachable (STRIPE_SECRET_KEY set)", false,
        "SKIPPED — no key, so the action stops before Order creation. " +
        "The Prisma-drift assertion above still ran.");
    } else {
      check("Order was created", !!order, order ? order.id : "none");
      if (order) {
        check('Order.source === "in_person"', order.source === "in_person", order.source);
        // The harness uses a fake connected account, so the Stripe session
        // create ALWAYS fails here. That used to throw and leave the order
        // pending forever; since the $0.50 checkout fix it is caught and the
        // order is closed with the same canceled/expired pair reconciliation
        // uses. These two assertions therefore describe the FAILURE path — the
        // one this environment can actually reach — not a successful sale.
        check('a failed Stripe setup closes the order (paymentStatus "expired")',
          order.paymentStatus === "expired", order.paymentStatus);
        check('a failed Stripe setup closes the order (status "canceled")',
          order.status === "canceled", order.status);
        check("no order is left pending after a failed Stripe setup",
          order.status !== "pending" && order.paymentStatus !== "pending",
          `${order.status}/${order.paymentStatus}`);
        check("Order.feeCents === 2 for a $1.00 sale", order.feeCents === 2, String(order.feeCents));
        check("Order.totalCents === 100", order.totalCents === 100, String(order.totalCents));
        check("exactly one OrderItem, quantity 1", order.items.length === 1 && order.items[0].quantity === 1,
          `${order.items.length} item(s)`);
        check('a "created" OrderEvent exists', order.events.some((e) => e.type === "created"),
          order.events.map((e) => e.type).join(",") || "none");
        check("no Stripe session was recorded (fake connected account)",
          !order.stripeSessionId, order.stripeSessionId ?? "null");

        const claimed = await prisma.walkUpSale.findUnique({
          where: { id: sale.id }, select: { orderId: true },
        });
        // The claim is RELEASED when Stripe setup fails, so the vendor can
        // retry the sale. Without that, a Stripe hiccup would brick the sale
        // permanently — the claim is exactly what stops a second attempt.
        check("a failed Stripe setup releases the claim so the sale can be retried",
          claimed?.orderId === null, claimed?.orderId ?? "null");
      }

      const orderCount = await prisma.order.count({ where: { sellerId: seller.id } });
      check("no duplicate Order", orderCount === 1, String(orderCount));

      // ---- The relationship invariant, on the walk-up path -----------------
      const customer = await prisma.customer.findUnique({ where: { email }, select: { id: true, signupSource: true } });
      if (customer) created.customer = customer.id;
      check("Customer was created", !!customer, customer?.id ?? "none");
      if (customer) {
        check('Customer.signupSource === "in_person"', customer.signupSource === "in_person",
          customer.signupSource ?? "null");
        const cv = await prisma.customerVendor.findFirst({
          where: { customerId: customer.id, sellerId: seller.id },
        });
        // applyFirstTouch only touches Customer, so at pending time there should
        // be no relationship row at all — and certainly no purchase facts.
        check("NO purchase relationship while payment is pending",
          !cv || (cv.orderCount === 0 && cv.totalSpentCents === 0 && cv.firstPurchaseAt === null),
          cv ? `orderCount=${cv.orderCount} spent=${cv.totalSpentCents} firstPurchaseAt=${cv.firstPurchaseAt?.toISOString() ?? "null"}` : "no row");
        check("no DropPoints awarded while payment is pending",
          (await prisma.pointsLedger.count({ where: { customerId: customer.id } })) === 0);
      }

      const prod = await prisma.product.findUnique({ where: { id: created.product! }, select: { sold: true } });
      check("inventory NOT consumed while payment is pending", prod?.sold === 0, String(prod?.sold));
    }
  } catch (e) {
    check("selftest ran without an unexpected exception", false,
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));
  } finally {
    if (prevFlag === undefined) delete process.env.WALKUP_ENABLED;
    else process.env.WALKUP_ENABLED = prevFlag;

    // FK-safe teardown. Each step is independent so one failure cannot strand
    // the rest; the baseline assertion below is what actually proves it worked.
    const drop_ = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* verified by baseline */ } };
    if (created.customer) {
      await drop_(() => prisma.pointsLedger.deleteMany({ where: { customerId: created.customer } }));
      await drop_(() => prisma.customerVendor.deleteMany({ where: { customerId: created.customer } }));
    }
    if (created.order) {
      await drop_(() => prisma.walkUpSale.updateMany({ where: { orderId: created.order }, data: { orderId: null } }));
      await drop_(() => prisma.orderEvent.deleteMany({ where: { orderId: created.order } }));
      await drop_(() => prisma.orderItem.deleteMany({ where: { orderId: created.order } }));
      await drop_(() => prisma.order.delete({ where: { id: created.order } }));
    }
    if (created.sale) await drop_(() => prisma.walkUpSale.delete({ where: { id: created.sale } }));
    if (created.product) await drop_(() => prisma.product.delete({ where: { id: created.product } }));
    if (created.drop) await drop_(() => prisma.drop.delete({ where: { id: created.drop } }));
    if (created.customer) await drop_(() => prisma.customer.delete({ where: { id: created.customer } }));
    if (created.seller) await drop_(() => prisma.seller.delete({ where: { id: created.seller } }));

    for (const [m, count] of Object.entries(TRACKED)) {
      const now = await count();
      check(`teardown restored ${m} to baseline`, now === baseline[m], `${baseline[m]} -> ${now}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json({
    suite: "walkup-pay-selftest",
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  });
}
