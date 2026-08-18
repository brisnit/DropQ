import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { newWalkUpToken, walkUpExpiry } from "@/lib/walkup";
import { TERMS_VERSION } from "@/lib/terms";

/**
 * Development-only UI regression cover for the focused in-person sale route,
 * `/dashboard/drops/[id]/sale`.
 *
 * The point of that route is isolation: a vendor mid-sale must not be looking
 * at share links, stats, catalogs, messaging or a danger zone. That is an
 * assertion about what is ABSENT, which nothing else in the suite checks — so
 * this renders the real authenticated page over HTTP and inspects the markup.
 *
 * Fixtures are created, rendered, torn down in a `finally`, and every table
 * count is asserted back to baseline. Nothing here touches Stripe, payment
 * finalization or the WalkUpSale lifecycle; sales are inserted directly so the
 * commerce path is never invoked.
 */

type Check = { name: string; pass: boolean; detail?: string };

const TRACKED: Record<string, () => Promise<number>> = {
  order: () => prisma.order.count(),
  customer: () => prisma.customer.count(),
  walkUpSale: () => prisma.walkUpSale.count(),
  product: () => prisma.product.count(),
  drop: () => prisma.drop.count(),
  seller: () => prisma.seller.count(),
};

/** Content that belongs to drop MANAGEMENT and must never appear mid-sale. */
const FORBIDDEN_ON_SALE_ROUTE = [
  "Share drop QR",
  "SHARE DROP",
  "Download QR",
  "Customer Communication",
  "Send Announcement",
  "Delete drop",
  "Publish drop",
  "Relaunch",
  "REVENUE",
];

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
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created: Record<string, string | undefined> = {};
  const prevFlag = process.env.WALKUP_ENABLED;

  // React splits adjacent expressions with <!-- -->; strip so text greps work.
  const clean = (h: string) => h.replace(/<!--[\s\S]*?-->/g, "");
  const { createHmac } = await import("node:crypto");
  const sign = (id: string) =>
    `${id}.${createHmac("sha256", process.env.SESSION_SECRET ?? "dropq-dev-secret").update(id).digest("hex")}`;
  const get = async (path: string, sellerId: string) => {
    const r = await fetch(origin + path, {
      redirect: "manual",
      headers: { cookie: `hp_session=${sign(sellerId)}` },
    });
    return { status: r.status, body: r.status === 200 ? clean(await r.text()) : "" };
  };

  try {
    process.env.WALKUP_ENABLED = "internal";

    const vendor = await prisma.seller.create({
      data: {
        email: `route-${stamp}@example.com`,
        slug: `route-${stamp}`,
        storeName: "Route Selftest Vendor",
        passwordHash: "x",
        internalKind: "selftest",
        stripeAccountId: `acct_route_${stamp}`,
        stripeChargesEnabled: true,
        // Without these the dashboard layout renders the Vendor Agreement gate
        // instead of the page, and every assertion below silently inspects it.
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      },
      select: { id: true },
    });
    created.seller = vendor.id;

    const drop = await prisma.drop.create({
      data: {
        sellerId: vendor.id,
        title: "Route Selftest Drop",
        status: "draft",
        mode: "preorder",
        fulfillment: "pickup",
        products: {
          create: [{ name: "Route Cookie", priceCents: 250, emoji: "🍪", inventory: 7, sold: 0, sortOrder: 0 }],
        },
      },
      include: { products: { select: { id: true } } },
    });
    created.drop = drop.id;
    created.product = drop.products[0].id;
    const saleHref = `/dashboard/drops/${drop.id}/sale`;

    // ---- Step 1: the cart screen ----------------------------------------
    const step1 = await get(saleHref, vendor.id);
    check("route renders for an enabled vendor", step1.status === 200, `status=${step1.status}`);
    check("step 1 heading is 'New in-person sale'", step1.body.includes("New in-person sale"));
    check("step 1 lists the product", step1.body.includes("Route Cookie"));
    check("step 1 shows price and remaining inventory",
      step1.body.includes("$2.50") && /7\s*left/.test(step1.body));
    check("step 1 has quantity controls", step1.body.includes("Add one Route Cookie") && step1.body.includes("Remove one Route Cookie"));
    check("step 1 has a running total", step1.body.includes("Total"));
    check("step 1 has Cancel", step1.body.includes("Cancel"));
    check("step 1 CTA present", step1.body.includes("Add an item") || step1.body.includes("Start sale"));
    check("payment QR is NOT shown before the sale starts",
      !step1.body.includes("Customer payment QR"));
    for (const t of FORBIDDEN_ON_SALE_ROUTE) {
      check(`step 1 hides drop-management content: "${t}"`, !step1.body.includes(t));
    }

    // ---- Step 2: an open sale -------------------------------------------
    const sale = await prisma.walkUpSale.create({
      data: {
        token: newWalkUpToken(),
        sellerId: vendor.id,
        dropId: drop.id,
        lines: [{ productId: drop.products[0].id, name: "Route Cookie", priceCents: 250, quantity: 2 }],
        expiresAt: walkUpExpiry(),
      },
      select: { id: true },
    });
    created.sale = sale.id;

    const step2 = await get(saleHref, vendor.id);
    check("step 2 renders", step2.status === 200, `status=${step2.status}`);
    check("step 2 shows the total prominently", step2.body.includes("$5.00"));
    check("step 2 shows the item count", /2\s*items/.test(step2.body));
    check("step 2 shows the line item", step2.body.includes("Route Cookie"));
    check("step 2 has the Customer payment QR heading",
      step2.body.includes("Customer payment QR") && step2.body.includes("in-person sale"));
    check("step 2 instructs: scan this to pay $5.00",
      step2.body.includes("Have the customer scan this to pay") && step2.body.includes("$5.00"));
    check("step 2 renders an actual QR image", step2.body.includes("data:image/png;base64"));
    check("step 2 shows the pay URL", step2.body.includes("/pay/"));
    check("step 2 states expiry", /Expires \d+ minutes/.test(step2.body));
    check("step 2 has Cancel sale", step2.body.includes("Cancel sale"));
    check("step 2 shows waiting status", step2.body.includes("Waiting for the customer to scan"));
    for (const t of FORBIDDEN_ON_SALE_ROUTE) {
      check(`step 2 hides drop-management content: "${t}"`, !step2.body.includes(t));
    }
    check("SHARE DROP QR is absent from the whole sale route",
      !/share drop/i.test(step2.body));

    // ---- Refresh recovery (no ?walkup= param) ---------------------------
    check("refresh without ?walkup= still recovers the open sale",
      step2.body.includes("Customer payment QR"));
    const withParam = await get(`${saleHref}?walkup=${sale.id}`, vendor.id);
    check("explicit ?walkup= renders the same sale",
      withParam.body.includes("Customer payment QR") && withParam.body.includes("$5.00"));

    // ---- The drop page is now only a doorway -----------------------------
    const dropPage = await get(`/dashboard/drops/${drop.id}`, vendor.id);
    check("drop page links into the sale route", dropPage.body.includes(`${saleHref}"`) || dropPage.body.includes(saleHref));
    check("drop page shows Resume while a sale is open", dropPage.body.includes("Resume in-person sale"));
    check("drop page no longer renders the payment QR",
      !dropPage.body.includes("Customer payment QR"));
    check("drop page still has its Share drop QR", /share drop qr/i.test(dropPage.body));

    // ---- Gating -----------------------------------------------------------
    const outsider = await prisma.seller.create({
      data: {
        email: `outsider-${stamp}@example.com`,
        slug: `outsider-${stamp}`,
        storeName: "Outsider",
        passwordHash: "x",
        internalKind: null, // external vendor
        stripeAccountId: `acct_out_${stamp}`,
        stripeChargesEnabled: true,
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      },
      select: { id: true },
    });
    created.outsider = outsider.id;
    const gated = await get(saleHref, outsider.id);
    check("external vendor cannot reach the sale route", gated.status === 404, `status=${gated.status}`);

    process.env.WALKUP_ENABLED = "";
    const flagOff = await get(saleHref, vendor.id);
    check("route 404s when WALKUP_ENABLED is off", flagOff.status === 404, `status=${flagOff.status}`);
    process.env.WALKUP_ENABLED = "internal";

    // ---- Cancelled sale falls back to the cart --------------------------
    await prisma.walkUpSale.update({ where: { id: sale.id }, data: { canceledAt: new Date() } });
    const afterCancel = await get(saleHref, vendor.id);
    check("after Cancel the route returns to the cart",
      afterCancel.body.includes("New in-person sale") && !afterCancel.body.includes("Customer payment QR"));

    // ---- Per-element containment ----------------------------------------
    // Page-level `scrollWidth === clientWidth` is NOT sufficient: the drop
    // page overflowed by 415px while reporting no page overflow, because the
    // body clips rather than scrolls. So assert on the markup that produces
    // that class of bug — an unconstrained grid child plus `truncate`, whose
    // `white-space: nowrap` gives the column a min-content width of the whole
    // string. Real bounding boxes are measured by the headless-Chrome audit;
    // this is the cheap always-on guard.
    const dropSrc = readFileSync("app/dashboard/drops/[id]/page.tsx", "utf8");
    for (const cls of ["lg:col-span-2", "lg:col-span-3"]) {
      const re = new RegExp(`className="[^"]*\\b${cls.replace(":", ":")}\\b[^"]*"`, "g");
      const all = dropSrc.match(re) ?? [];
      check(`every .${cls} grid child carries min-w-0`,
        all.length > 0 && all.every((m) => m.includes("min-w-0")),
        all.join(" | ").slice(0, 160));
    }
    check("drop page header actions wrap on narrow screens",
      /className="flex flex-wrap items-center gap-2"/.test(dropSrc));

    const saleSrc = readFileSync("app/dashboard/drops/[id]/sale/page.tsx", "utf8");
    check("sale route constrains its own column and can shrink",
      /max-w-2xl/.test(saleSrc) && /min-w-0/.test(saleSrc));
    check("sale route lets the pay URL break instead of widening its parent",
      /break-all/.test(saleSrc));
    check("sale route line items can shrink and wrap long product names",
      /min-w-0 break-words/.test(saleSrc));
    check("payment QR is width-capped rather than rendered at intrinsic size",
      /max-w-\[260px\]/.test(saleSrc));

  } catch (e) {
    check("selftest ran without an unexpected exception", false,
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));
  } finally {
    if (prevFlag === undefined) delete process.env.WALKUP_ENABLED;
    else process.env.WALKUP_ENABLED = prevFlag;

    const attempt = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* baseline catches it */ } };
    if (created.sale) await attempt(() => prisma.walkUpSale.delete({ where: { id: created.sale } }));
    if (created.drop) {
      await attempt(() => prisma.walkUpSale.deleteMany({ where: { dropId: created.drop } }));
      await attempt(() => prisma.product.deleteMany({ where: { dropId: created.drop } }));
      await attempt(() => prisma.drop.delete({ where: { id: created.drop } }));
    }
    for (const id of [created.seller, created.outsider].filter(Boolean) as string[]) {
      await attempt(() => prisma.seller.delete({ where: { id } }));
    }
    for (const [m, count] of Object.entries(TRACKED)) {
      const now = await count();
      check(`teardown restored ${m} to baseline`, now === baseline[m], `${baseline[m]} -> ${now}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json({
    suite: "walkup-route-selftest",
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  });
}
