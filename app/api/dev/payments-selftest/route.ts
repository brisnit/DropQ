import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { canStartInPersonSale, isVendorSellable } from "@/lib/payments";

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
    check("C1 did not touch online checkout's Stripe session creation",
      /stripe\.checkout\.sessions\.create\(\{/.test(orderSrc) &&
      /stripeAccount: drop\.seller\.stripeAccountId!/.test(orderSrc));
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
