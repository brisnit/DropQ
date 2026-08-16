import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { POST as stripeWebhook } from "@/app/api/stripe/webhook/route";

/**
 * Development-only proof that the Stripe webhook verifies BOTH signing secrets.
 *
 * Production ran for weeks with a 100% failure rate on the Connect destination:
 * one URL receives events from two Stripe destinations (account and Connect),
 * each signs with its own secret, and the route only ever checked one. Nothing
 * looked broken because the customer's `/order/[id]` redirect was finalizing
 * orders — the webhook is only the fallback, and the fallback was dead.
 *
 * Side-effect free by construction: every event here is `invoice.payment_failed`,
 * a type the route's switch does not handle, so it falls straight through to
 * `200 ok`. Signature verification is the only thing under test, and the DB
 * counts are asserted unchanged at the end.
 */

type Check = { name: string; pass: boolean; detail?: string };

const ACCOUNT_SECRET = "whsec_selftest_account_0000000000000000";
const CONNECT_SECRET = "whsec_selftest_connect_1111111111111111";
const FOREIGN_SECRET = "whsec_selftest_foreign_2222222222222222";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail });

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({
      suite: "webhook-selftest",
      passed: 0,
      failed: 1,
      checks: [{ name: "STRIPE_SECRET_KEY present", pass: false, detail: "no key — cannot sign test payloads" }],
    });
  }

  const before = {
    order: await prisma.order.count(),
    orderEvent: await prisma.orderEvent.count(),
    pointsLedger: await prisma.pointsLedger.count(),
    seller: await prisma.seller.count(),
  };

  const prevAccount = process.env.STRIPE_WEBHOOK_SECRET;
  const prevConnect = process.env.STRIPE_WEBHOOK_SECRET_CONNECT;

  // An event type the switch ignores — verification runs, no handler fires.
  const payload = JSON.stringify({
    id: "evt_selftest",
    object: "event",
    type: "invoice.payment_failed",
    data: { object: { id: "in_selftest" } },
  });

  const post = async (signingSecret: string | null) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (signingSecret) {
      headers["stripe-signature"] = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: signingSecret,
      });
    }
    const req = new NextRequest("https://www.drop-q.com/api/stripe/webhook", {
      method: "POST",
      body: payload,
      headers,
    });
    const res = await stripeWebhook(req);
    return res.status;
  };

  try {
    process.env.STRIPE_WEBHOOK_SECRET = ACCOUNT_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET_CONNECT = CONNECT_SECRET;

    const acct = await post(ACCOUNT_SECRET);
    check("account-signed event verifies (existing destination still works)", acct === 200, `status=${acct}`);

    const conn = await post(CONNECT_SECRET);
    check("connect-signed event verifies (the production failure)", conn === 200, `status=${conn}`);

    const foreign = await post(FOREIGN_SECRET);
    check("event signed by neither secret is rejected", foreign === 400, `status=${foreign}`);

    const unsigned = await post(null);
    check("event with no stripe-signature header is rejected", unsigned === 400, `status=${unsigned}`);

    // Order matters: the account secret must not be shadowed by the connect one.
    delete process.env.STRIPE_WEBHOOK_SECRET_CONNECT;
    const acctOnly = await post(ACCOUNT_SECRET);
    check("account secret still works when no connect secret is configured", acctOnly === 200, `status=${acctOnly}`);
    const connWithoutVar = await post(CONNECT_SECRET);
    check("connect-signed event fails when the connect secret is absent",
      connWithoutVar === 400, `status=${connWithoutVar} (this is the pre-fix production behaviour)`);

    process.env.STRIPE_WEBHOOK_SECRET_CONNECT = CONNECT_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const connOnly = await post(CONNECT_SECRET);
    check("connect secret works even if the account secret is unset", connOnly === 200, `status=${connOnly}`);
  } catch (e) {
    check("selftest ran without an unexpected exception", false,
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));
  } finally {
    if (prevAccount === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevAccount;
    if (prevConnect === undefined) delete process.env.STRIPE_WEBHOOK_SECRET_CONNECT;
    else process.env.STRIPE_WEBHOOK_SECRET_CONNECT = prevConnect;

    const after = {
      order: await prisma.order.count(),
      orderEvent: await prisma.orderEvent.count(),
      pointsLedger: await prisma.pointsLedger.count(),
      seller: await prisma.seller.count(),
    };
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      check(`no side effects on ${k}`, before[k] === after[k], `${before[k]} -> ${after[k]}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json({
    suite: "webhook-selftest",
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  });
}
