import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { planRemovals, removalWarning } from "@/lib/drop-items";

/**
 * Drop-item removal self-test — "an item a customer bought is never deleted."
 *
 *   curl localhost:3000/api/dev/drop-items-selftest
 *
 * Pure: no database, no network, writes nothing. 404s in production.
 *
 * BACKGROUND. `updateDropFullAction` used to delete every product missing from
 * the submitted form, unconditionally:
 *
 *     if (removed.length) await prisma.product.deleteMany({ where: { id: { in: removed }, dropId } })
 *
 * Orders survived that (OrderItem snapshots name and price, and its FK is
 * SetNull), but `OrderItem.productId` was severed, taking per-item sell-through
 * and the drop's Sold count with it. A production sweep on 2026-08-29 found 17
 * of 32 products referenced by an order and ZERO severed order lines — the path
 * had never fired. This suite exists so it never does.
 *
 * The decision itself lives in lib/drop-items.ts as a pure function precisely so
 * it can be asserted here without touching the production database this repo's
 * .env points at.
 */

type Result = { name: string; pass: boolean; detail?: string };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ------------------------------ The rule ------------------------------- */
  {
    const plan = planRemovals(["a", "b", "c"], ["b"]);
    check("an item with orders is never deletable",
      !plan.deletable.includes("b") && plan.retirable.includes("b"));
    check("items without orders are still deleted",
      plan.deletable.join() === "a,c", plan.deletable.join());
    check("every removed id is accounted for exactly once",
      plan.deletable.length + plan.retirable.length === 3);
  }

  check("nothing removed -> nothing happens",
    (() => { const p = planRemovals([], []); return !p.deletable.length && !p.retirable.length; })());

  check("all removed items have orders -> zero deletions",
    (() => { const p = planRemovals(["a", "b"], ["a", "b"]); return p.deletable.length === 0
      && p.retirable.join() === "a,b"; })());

  check("no removed item has orders -> zero retirements",
    (() => { const p = planRemovals(["a", "b"], []); return p.retirable.length === 0
      && p.deletable.join() === "a,b"; })());

  /* --------------------------- Input hardening --------------------------- */
  check("duplicate removed ids collapse rather than double-delete",
    (() => { const p = planRemovals(["a", "a", "b"], []); return p.deletable.join() === "a,b"; })());

  check("empty-string ids are dropped",
    (() => { const p = planRemovals(["", "a"], []); return p.deletable.join() === "a"; })());

  check("an order id that was NOT removed cannot widen the deletion",
    // The caller reads `idsWithOrders` from the database; this function decides.
    // A stray id in that set must not cause anything extra to be deleted.
    (() => { const p = planRemovals(["a"], ["zzz"]); return p.deletable.join() === "a"
      && p.retirable.length === 0; })());

  check("removal order is preserved",
    (() => { const p = planRemovals(["c", "a", "b"], ["a"]); return p.deletable.join() === "c,b"; })());

  /* ------------------------------ The warning ---------------------------- */
  {
    const one = removalWarning("Brown butter cookie", 1);
    const many = removalWarning("Brown butter cookie", 4);
    check("the warning names the item", one.includes("Brown butter cookie"));
    check("one order reads as singular throughout",
      one.includes("1 order") && !one.includes("1 orders") && one.includes("That order is kept"),
      one);
    check("several orders read as plural throughout",
      many.includes("4 orders") && many.includes("Those orders are kept"), many);
    check("the warning says what SURVIVES, not just what stops",
      one.includes("kept") && many.includes("kept") && many.includes("sales history"));
    check("the warning states the storefront consequence",
      many.includes("sold out"));
  }

  /* ----------------------------- Source pins ----------------------------- */
  {
    const src = readFileSync("lib/actions/dashboard.ts", "utf8");

    check("updateDropFullAction no longer deletes `removed` unconditionally",
      !/deleteMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*removed\s*\}/.test(src));

    check("it deletes only the planned-deletable set",
      /deleteMany\(\{ where: \{ id: \{ in: deletable \}, dropId \} \}\)/.test(src));

    check("it retires with a set-based SQL update, not a JS-read `sold`",
      /UPDATE "Product" SET inventory = sold/.test(src));

    check("the retire statement is scoped to this drop",
      /UPDATE "Product" SET inventory = sold\s*\n?\s*WHERE "dropId" = /.test(src));

    check("the decision comes from lib/drop-items.ts, not inline logic",
      /planRemovals\(/.test(src) && /from "@\/lib\/drop-items"/.test(src));
  }

  {
    const editor = readFileSync("components/drop-editor.tsx", "utf8");
    check("the editor warns before removing an item with orders",
      /removalWarning\(/.test(editor) && /orderCount > 0/.test(editor));
    check("the editor's confirm can be cancelled without removing the row",
      /if \(!window\.confirm\(removalWarning\(name, row\.orderCount\)\)\) return;/.test(editor));
  }

  {
    const page = readFileSync("app/dashboard/drops/[id]/edit/page.tsx", "utf8");
    check("the edit page supplies the order count the warning needs",
      /_count: \{ select: \{ orderItems: true \} \}/.test(page) &&
        /orderCount: p\._count\.orderItems/.test(page));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "drop-items",
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
