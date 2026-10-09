import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { INTERNAL_KINDS } from "@/lib/reporting";
import { fixtureRefusal, fixtureRefusalBody } from "@/lib/fixture-guard";

/**
 * The public vendor directory and the printable pickup sheet.
 *
 * Both are new surfaces that show things which must not reach the wrong
 * person. The directory makes vendor stores public, and the pickup sheet is
 * made almost entirely of customer names and phone numbers. These are the
 * rules that keep each one honest.
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
  // Stamped with the clock as well as randomness: the isolation suite
  // requires it, so a stray fixture row is always identifiable as one.
  const stamp = Date.now().toString(36);
  const rnd = () => `${stamp}-${Math.random().toString(36).slice(2, 8)}`;

  const mk = (over: Record<string, unknown> = {}) =>
    prisma.seller.create({
      data: {
        email: `dir-${rnd()}@example.com`,
        passwordHash: "x",
        storeName: `Directory Fixture ${rnd()}`,
        slug: `dir-${rnd()}`,
        category: "food",
        referralCode: rnd().toUpperCase(),
        ...over,
      },
    });
  const withDrop = (sellerId: string, status: string, isPublic = true) =>
    prisma.drop.create({ data: { sellerId, title: "Fixture drop", status, isPublic } });

  /* ------------------ 1. Who the directory lists ------------------------ */
  const published = await mk();            await withDrop(published.id, "live");
  const closedOnly = await mk();           await withDrop(closedOnly.id, "closed");
  const draftOnly = await mk();            await withDrop(draftOnly.id, "draft");
  const privateOnly = await mk();          await withDrop(privateOnly.id, "live", false);
  const noDrops = await mk();
  const internal = await mk({ internalKind: "demo" }); await withDrop(internal.id, "live");
  const disabled = await mk({ disabledAt: new Date() }); await withDrop(disabled.id, "live");

  // The exact query the page runs.
  const listed = await prisma.seller.findMany({
    where: {
      disabledAt: null,
      OR: [{ internalKind: null }, { internalKind: { notIn: [...INTERNAL_KINDS] } }],
      drops: { some: { isPublic: true, status: { in: ["live", "closed"] } } },
    },
    select: { id: true },
  });
  const ids = new Set(listed.map((s) => s.id));

  check("a vendor with a live drop is listed", ids.has(published.id));
  check("a vendor whose drop has closed is still listed", ids.has(closedOnly.id));
  check("a draft-only vendor is NOT listed — nothing is public yet", !ids.has(draftOnly.id));
  check("a private-drop vendor is NOT listed", !ids.has(privateOnly.id));
  check("a vendor with no drops is NOT listed", !ids.has(noDrops.id));
  check("an internal account is NOT listed", !ids.has(internal.id));
  check("a disabled store is NOT listed", !ids.has(disabled.id));

  /* ------------------ 2. What the directory shows ----------------------- */
  {
    // Comments stripped: the page explains at length WHY it does not gate on
    // isDiscoverable, and a naive scan reads that explanation as the thing it
    // is promising not to do.
    const src = readFileSync("app/vendors/page.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // The opt-in defaults to false and is no longer reachable from the
    // dashboard, so gating on it would silently empty this page.
    check("the directory does not gate on isDiscoverable", !/isDiscoverable/.test(src));
    check("it excludes internal accounts using the shared list", /INTERNAL_KINDS/.test(src));
    check("it selects no customer data", !/buyerName|buyerEmail|buyerPhone/.test(src));
    check("it selects no vendor contact details",
      !/\bemail:\s*true|\bphone:\s*true/.test(src));
  }

  /* ------------------ 3. The pickup sheet's access rule ----------------- */
  {
    const sheet = readFileSync("app/dashboard/drops/[id]/pickup-list/page.tsx", "utf8");
    check("the pickup sheet requires a signed-in vendor", /requireSeller\(\)/.test(sheet));
    check("...and 404s on a drop belonging to someone else",
      /drop\.sellerId !== seller\.id\)\s*notFound\(\)/.test(sheet));
    check("it lists paid orders only", /paymentStatus: "paid"/.test(sheet));
    check("it never reads a buyer's email address", !/buyerEmail/.test(sheet));

    // Proved, not just read: the same scoping expressed as a query must find
    // nothing when the drop belongs to another vendor.
    const other = await mk();
    const otherDrop = await withDrop(other.id, "live");
    const leaked = await prisma.drop.findFirst({
      where: { id: otherDrop.id, sellerId: published.id },
    });
    check("a drop id scoped to the wrong vendor returns nothing", leaked === null);
    await prisma.drop.deleteMany({ where: { sellerId: other.id } });
    await prisma.seller.delete({ where: { id: other.id } });
  }

  /* ------------------ 4. Discovery is out of the dashboard -------------- */
  for (const nav of ["components/mobile-nav.tsx", "components/dashboard-nav.tsx"]) {
    check(`${nav} no longer offers Discovery`,
      !/discoverability/.test(readFileSync(nav, "utf8")));
  }
  // The page itself is deliberately still reachable: it holds the
  // hide-exact-address control and the public location fields, and deleting
  // it would remove a privacy setting rather than just a menu entry.
  check("the discoverability page still exists, so no privacy control was lost",
    readFileSync("app/dashboard/discoverability/page.tsx", "utf8").includes("hideExactAddress"));

  /* ----------------------------- teardown ------------------------------- */
  const made = [published, closedOnly, draftOnly, privateOnly, noDrops, internal, disabled];
  await prisma.drop.deleteMany({ where: { sellerId: { in: made.map((s) => s.id) } } });
  await prisma.seller.deleteMany({ where: { id: { in: made.map((s) => s.id) } } });

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    { suite: "directory", passed, failed: failures.length, results: failures.length ? failures : "all pass" },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
