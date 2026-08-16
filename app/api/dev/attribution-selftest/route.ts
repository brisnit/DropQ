import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { applyFirstTouch } from "@/lib/attribution";
import { payWalkUpSaleAction } from "@/lib/actions/pay";
import { newWalkUpToken, walkUpExpiry } from "@/lib/walkup";

/**
 * Development-only regression cover for walk-up acquisition attribution.
 *
 * The first successful production canary was credited to the WRONG vendor:
 * `applyFirstTouch` preferred the `dq_touch` cookie over the caller's own
 * signal, and the customer's phone carried a two-day-old cookie from browsing
 * a different storefront. A physical, vendor-initiated sale is better evidence
 * than that, so `pay.ts` now passes `{ authoritative: true }`.
 *
 * Cookie state is per-request and `cookies()` is read-only, so one GET cannot
 * cover both the with-cookie and without-cookie cases. The runner calls this
 * route TWICE and the route reports which scenario it ran:
 *
 *   with a conflicting dq_touch  → tests 1, 3, 4
 *   with no dq_touch             → test 2
 *
 * Fixtures are created, exercised, torn down in a `finally`, and every table
 * count is asserted back to baseline — a cleanup miss fails the test rather
 * than leaking rows. The fixture vendor's connected account is fake, so the
 * walk-up action stops at Stripe's boundary, after the attribution we inspect.
 */

type Check = { name: string; pass: boolean; detail?: string };

const TRACKED: Record<string, () => Promise<number>> = {
  order: () => prisma.order.count(),
  customer: () => prisma.customer.count(),
  customerVendor: () => prisma.customerVendor.count(),
  walkUpSale: () => prisma.walkUpSale.count(),
  product: () => prisma.product.count(),
  drop: () => prisma.drop.count(),
  seller: () => prisma.seller.count(),
};

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    checks.push({ name, pass, detail });

  const baseline: Record<string, number> = {};
  for (const [m, count] of Object.entries(TRACKED)) baseline[m] = await count();

  const raw = (await cookies()).get("dq_touch")?.value;
  let cookieSlug: string | null = null;
  try {
    cookieSlug = raw ? (JSON.parse(raw).vendorSlug ?? null) : null;
  } catch {
    cookieSlug = null;
  }
  const scenario = cookieSlug ? "with-conflicting-cookie" : "no-cookie";

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const created: Record<string, string | undefined> = {};
  const prevFlag = process.env.WALKUP_ENABLED;
  const emails: string[] = [];

  const makeVendor = async (tag: string) =>
    prisma.seller.create({
      data: {
        email: `attr-${tag}-${stamp}@example.com`,
        slug: `attr-${tag}-${stamp}`,
        storeName: `Attribution ${tag}`,
        passwordHash: "x",
        internalKind: "selftest",
        stripeAccountId: `acct_attr_${tag}_${stamp}`,
        stripeChargesEnabled: true,
      },
      select: { id: true, slug: true },
    });

  try {
    process.env.WALKUP_ENABLED = "internal";

    const walkUpVendor = await makeVendor("walkup");
    created.seller = walkUpVendor.id;

    const drop = await prisma.drop.create({
      data: {
        sellerId: walkUpVendor.id,
        title: "Attribution Selftest Drop",
        status: "draft",
        mode: "preorder",
        fulfillment: "pickup",
        products: { create: [{ name: "Attr Cookie", priceCents: 100, emoji: "🍪", inventory: 5, sold: 0, sortOrder: 0 }] },
      },
      include: { products: { select: { id: true } } },
    });
    created.drop = drop.id;
    created.product = drop.products[0].id;

    const runWalkUp = async (email: string) => {
      const token = newWalkUpToken();
      const sale = await prisma.walkUpSale.create({
        data: {
          token,
          sellerId: walkUpVendor.id,
          dropId: drop.id,
          lines: [{ productId: drop.products[0].id, name: "Attr Cookie", priceCents: 100, quantity: 1 }],
          expiresAt: walkUpExpiry(),
        },
        select: { id: true },
      });
      const fd = new FormData();
      fd.set("token", token);
      fd.set("firstName", "Attr");
      fd.set("email", email);
      try {
        await payWalkUpSaleAction({}, fd);
      } catch {
        // Expected: the fake connected account fails at Stripe's boundary,
        // which is AFTER upsertCustomer and applyFirstTouch have run.
      }
      emails.push(email);
      return sale.id;
    };

    if (scenario === "with-conflicting-cookie") {
      check("scenario: dq_touch present and names another vendor", !!cookieSlug, `cookie vendorSlug=${cookieSlug}`);

      // ---- TEST 1 -------------------------------------------------------
      const e1 = `attr-t1-${stamp}@example.com`;
      await runWalkUp(e1);
      const c1 = await prisma.customer.findUnique({ where: { email: e1 } });
      check("T1 walk-up customer created despite the cookie", !!c1, c1?.id ?? "none");
      check('T1 signupSource === "in_person" (not the cookie\'s source)',
        c1?.signupSource === "in_person", c1?.signupSource ?? "null");
      check("T1 firstVendorId === the WALK-UP vendor, not the cookie vendor",
        c1?.firstVendorId === walkUpVendor.id, `${c1?.firstVendorId} vs walkup=${walkUpVendor.id}`);
      check("T1 firstDropId === the walk-up drop", c1?.firstDropId === drop.id, c1?.firstDropId ?? "null");
      check("T1 firstTouchAt is the sale, not the stale cookie timestamp",
        !!c1?.firstTouchAt && Date.now() - c1.firstTouchAt.getTime() < 5 * 60_000,
        c1?.firstTouchAt?.toISOString() ?? "null");

      // ---- TEST 3 -------------------------------------------------------
      const otherVendor = await makeVendor("other");
      created.otherSeller = otherVendor.id;
      const e3 = `attr-t3-${stamp}@example.com`;
      const pre = await prisma.customer.create({
        data: {
          email: e3,
          name: "Pre Attributed",
          signupSource: "storefront",
          firstVendorId: otherVendor.id,
          firstTouchAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        select: { id: true },
      });
      created.preCustomer = pre.id;
      await applyFirstTouch(
        pre.id,
        { vendorId: walkUpVendor.id, dropId: drop.id, source: "in_person", detail: walkUpVendor.slug },
        { authoritative: true }
      );
      const after3 = await prisma.customer.findUnique({ where: { id: pre.id } });
      check("T3 pre-attributed customer keeps signupSource",
        after3?.signupSource === "storefront", after3?.signupSource ?? "null");
      check("T3 pre-attributed customer keeps firstVendorId (authoritative cannot rewrite)",
        after3?.firstVendorId === otherVendor.id, `${after3?.firstVendorId} vs original=${otherVendor.id}`);
      check("T3 pre-attributed customer keeps firstTouchAt",
        after3?.firstTouchAt?.toISOString() === "2026-01-01T00:00:00.000Z",
        after3?.firstTouchAt?.toISOString() ?? "null");

      // ---- TEST 4 -------------------------------------------------------
      const e4 = `attr-t4-${stamp}@example.com`;
      const web = await prisma.customer.create({ data: { email: e4, name: "Web" }, select: { id: true } });
      created.webCustomer = web.id;
      // No `authoritative` — exactly how order.ts / vendor-follow.ts call it.
      await applyFirstTouch(web.id, {
        vendorId: walkUpVendor.id,
        dropId: drop.id,
        source: "storefront",
        detail: walkUpVendor.slug,
      });
      const after4 = await prisma.customer.findUnique({ where: { id: web.id } });
      const cookieVendor = await prisma.seller.findFirst({ where: { slug: cookieSlug ?? "" }, select: { id: true } });
      check("T4 storefront path is still COOKIE-FIRST — cookie vendor wins",
        !!cookieVendor && after4?.firstVendorId === cookieVendor.id,
        `firstVendorId=${after4?.firstVendorId} cookieVendor=${cookieVendor?.id ?? "unresolvable"}`);
      check("T4 storefront path took the cookie's source",
        after4?.signupSource === "storefront", after4?.signupSource ?? "null");
    } else {
      // ---- TEST 2 -------------------------------------------------------
      check("scenario: no dq_touch cookie on the request", cookieSlug === null);
      const e2 = `attr-t2-${stamp}@example.com`;
      await runWalkUp(e2);
      const c2 = await prisma.customer.findUnique({ where: { email: e2 } });
      check("T2 walk-up customer created", !!c2, c2?.id ?? "none");
      check('T2 signupSource === "in_person" with no cookie present',
        c2?.signupSource === "in_person", c2?.signupSource ?? "null");
      check("T2 firstVendorId === the walk-up vendor",
        c2?.firstVendorId === walkUpVendor.id, `${c2?.firstVendorId} vs ${walkUpVendor.id}`);
    }
  } catch (e) {
    check("selftest ran without an unexpected exception", false,
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));
  } finally {
    if (prevFlag === undefined) delete process.env.WALKUP_ENABLED;
    else process.env.WALKUP_ENABLED = prevFlag;

    const attempt = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* baseline check catches it */ } };
    const ids = [created.seller, created.otherSeller].filter(Boolean) as string[];
    for (const email of emails) {
      const c = await prisma.customer.findUnique({ where: { email }, select: { id: true } });
      if (!c) continue;
      await attempt(() => prisma.pointsLedger.deleteMany({ where: { customerId: c.id } }));
      await attempt(() => prisma.customerVendor.deleteMany({ where: { customerId: c.id } }));
      await attempt(() => prisma.order.deleteMany({ where: { customerId: c.id } }));
      await attempt(() => prisma.customer.delete({ where: { id: c.id } }));
    }
    for (const id of [created.preCustomer, created.webCustomer].filter(Boolean) as string[]) {
      await attempt(() => prisma.customerVendor.deleteMany({ where: { customerId: id } }));
      await attempt(() => prisma.customer.delete({ where: { id } }));
    }
    for (const id of ids) {
      await attempt(() => prisma.order.deleteMany({ where: { sellerId: id } }));
      await attempt(() => prisma.walkUpSale.deleteMany({ where: { sellerId: id } }));
    }
    if (created.drop) {
      await attempt(() => prisma.product.deleteMany({ where: { dropId: created.drop } }));
      await attempt(() => prisma.drop.delete({ where: { id: created.drop } }));
    }
    for (const id of ids) await attempt(() => prisma.seller.delete({ where: { id } }));

    for (const [m, count] of Object.entries(TRACKED)) {
      const now = await count();
      check(`teardown restored ${m} to baseline`, now === baseline[m], `${baseline[m]} -> ${now}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json({
    suite: "attribution-selftest",
    scenario,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  });
}
