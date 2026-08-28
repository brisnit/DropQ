/**
 * Drop schedule self-test — "an invalid date relationship cannot be persisted."
 *
 *   node --env-file=.env scripts/drop-schedule-selftest.mjs
 *
 * BACKGROUND. Two production drops carry invalid schedules:
 *
 *   Frog Incense Holder   opensAt 2026-06-20T20:00Z, closesAt 2026-06-18T00:00Z
 *   Papel picado coasters opensAt 2026-06-20T20:02Z, closesAt NULL
 *
 * Both were created by the same seller on 2026-06-17 (PDT), when the drop
 * editor was two bare, optional <input type="datetime-local"> fields with no
 * ordering check and no calendar picker — see commit fa58458's drop-editor.tsx.
 * Client validation landed ~21h later (5948c5b) and the range picker five days
 * later (df5d14c). `createDropAction` never checked anything, then or since.
 *
 * lib/drop-schedule.ts is TypeScript imported by a "use client" component, so
 * this harness mirrors the rules and asserts source parity at the bottom —
 * the same approach as scripts/phase-a-selftest.mjs. Writes NOTHING; the one
 * database query is a read-only production sweep.
 */
import { readFileSync } from "node:fs";

let pass = 0;
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { failures.push(name); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function section(t) { console.log(`\n${t}`); }

// ── Mirror of lib/drop-schedule.ts ──────────────────────────────────────────
const bad = (d) => d !== null && Number.isNaN(d.getTime());
function validateDropSchedule({ opensAt, closesAt, pickupStartAt, pickupEndAt }) {
  const issues = [];
  const named = [
    ["opensAt", opensAt, "open date/time"],
    ["closesAt", closesAt, "close date/time"],
    ["pickupStartAt", pickupStartAt, "pickup start"],
    ["pickupEndAt", pickupEndAt, "pickup end"],
  ];
  for (const [field, value, label] of named) {
    if (bad(value)) issues.push({ field, code: "invalid_date", message: `The ${label} isn't a valid date.` });
  }
  if (issues.length) return issues;
  if (opensAt && !closesAt) issues.push({ field: "closesAt", code: "half_open_order_window", message: "half-open order window" });
  if (!opensAt && closesAt) issues.push({ field: "opensAt", code: "half_open_order_window", message: "half-open order window" });
  if (pickupStartAt && !pickupEndAt) issues.push({ field: "pickupEndAt", code: "half_open_pickup_window", message: "half-open pickup window" });
  if (!pickupStartAt && pickupEndAt) issues.push({ field: "pickupStartAt", code: "half_open_pickup_window", message: "half-open pickup window" });
  if (opensAt && closesAt && closesAt <= opensAt) issues.push({ field: "closesAt", code: "close_before_open", message: "close before open" });
  if (pickupStartAt && pickupEndAt && pickupEndAt <= pickupStartAt) issues.push({ field: "pickupEndAt", code: "pickup_end_before_start", message: "pickup end before start" });
  if (closesAt && pickupStartAt && pickupStartAt < closesAt) issues.push({ field: "pickupStartAt", code: "pickup_before_close", message: "pickup starts before ordering closes" });
  return issues;
}
/** Stable, order-independent fingerprint of what is wrong with a schedule. */
const signature = (d) => validateDropSchedule(d).map((i) => `${i.field}:${i.code}`).sort().join(" + ");
const valid = (i) => validateDropSchedule(i).length === 0;

const D = (s) => (s === null ? null : new Date(s));
/** A schedule with every field set and every rule satisfied. */
function sched(o) {
  return {
    opensAt: D("2026-09-01T16:00:00Z"),
    closesAt: D("2026-09-05T00:00:00Z"),
    pickupStartAt: D("2026-09-06T16:00:00Z"),
    pickupEndAt: D("2026-09-07T00:00:00Z"),
    ...o,
  };
}

// ── 1. The rules ────────────────────────────────────────────────────────────
section("Valid schedules are accepted");
ok("a fully-specified drop", valid(sched()));
ok("no dates at all (3 closed production drops look like this)",
   valid({ opensAt: null, closesAt: null, pickupStartAt: null, pickupEndAt: null }));
ok("an order window with no pickup window",
   valid(sched({ pickupStartAt: null, pickupEndAt: null })));
ok("pickup starting exactly at close — 'on or after' allows back-to-back",
   valid(sched({ pickupStartAt: D("2026-09-05T00:00:00Z"), pickupEndAt: D("2026-09-05T04:00:00Z") })));
ok("a one-minute order window",
   valid(sched({ opensAt: D("2026-09-01T16:00:00Z"), closesAt: D("2026-09-01T16:01:00Z") })));

section("Historical drops stay editable (no rule reads the clock)");
ok("a drop whose windows are entirely in the past is valid",
   valid({ opensAt: D("2020-01-01T00:00:00Z"), closesAt: D("2020-01-02T00:00:00Z"),
           pickupStartAt: D("2020-01-03T00:00:00Z"), pickupEndAt: D("2020-01-04T00:00:00Z") }));
ok("validity does not depend on when the check runs",
   JSON.stringify(validateDropSchedule(sched())) === JSON.stringify(validateDropSchedule(sched())));

section("Close before open is rejected");
ok("closesAt < opensAt (the Frog Incense Holder shape)",
   !valid({ opensAt: D("2026-06-20T20:00:00Z"), closesAt: D("2026-06-18T00:00:00Z"),
            pickupStartAt: null, pickupEndAt: null }));
ok("closesAt === opensAt (a zero-length order window)",
   !valid(sched({ opensAt: D("2026-09-01T16:00:00Z"), closesAt: D("2026-09-01T16:00:00Z") })));
ok("the issue points at closesAt",
   validateDropSchedule(sched({ closesAt: D("2026-08-01T00:00:00Z") }))[0].field === "closesAt");

section("Pickup end before pickup start is rejected");
ok("pickupEndAt < pickupStartAt",
   !valid(sched({ pickupStartAt: D("2026-09-06T16:00:00Z"), pickupEndAt: D("2026-09-06T08:00:00Z") })));
ok("pickupEndAt === pickupStartAt",
   !valid(sched({ pickupStartAt: D("2026-09-06T16:00:00Z"), pickupEndAt: D("2026-09-06T16:00:00Z") })));

section("Ordering must close before pickup starts");
ok("pickup starting before ordering closes is rejected",
   !valid(sched({ pickupStartAt: D("2026-09-04T00:00:00Z"), pickupEndAt: D("2026-09-04T08:00:00Z") })));
ok("a pickup window fully inside the order window is rejected",
   !valid(sched({ pickupStartAt: D("2026-09-02T00:00:00Z"), pickupEndAt: D("2026-09-03T00:00:00Z") })));
ok("one second early is still rejected",
   !valid(sched({ pickupStartAt: D("2026-09-04T23:59:59Z"), pickupEndAt: D("2026-09-06T00:00:00Z") })));

section("Half-open windows are rejected");
ok("opensAt with no closesAt (the Papel picado coasters shape)",
   !valid({ opensAt: D("2026-06-20T20:02:00Z"), closesAt: null, pickupStartAt: null, pickupEndAt: null }));
ok("closesAt with no opensAt",
   !valid({ opensAt: null, closesAt: D("2026-09-05T00:00:00Z"), pickupStartAt: null, pickupEndAt: null }));
ok("pickupStartAt with no pickupEndAt", !valid(sched({ pickupEndAt: null })));
ok("pickupEndAt with no pickupStartAt", !valid(sched({ pickupStartAt: null })));

section("Unparseable dates are rejected, not passed to Prisma");
ok("new Date('banana') is caught", !valid(sched({ opensAt: new Date("banana") })));
ok("the message names the field", /open date\/time isn't a valid date/.test(
   validateDropSchedule(sched({ opensAt: new Date("banana") }))[0].message));
ok("an invalid date short-circuits the relational rules",
   validateDropSchedule({ opensAt: new Date("banana"), closesAt: null,
                          pickupStartAt: null, pickupEndAt: null }).length === 1);

section("Timezone behaviour is untouched (instants only)");
// 2026-09-05T00:00Z is 2026-09-04 17:00 in Los Angeles. The rules compare
// instants, so the same pair must classify identically however it is written.
ok("an offset-form instant equals its Z-form",
   JSON.stringify(validateDropSchedule(sched({ closesAt: D("2026-09-04T17:00:00-07:00") })))
   === JSON.stringify(validateDropSchedule(sched({ closesAt: D("2026-09-05T00:00:00Z") }))));
ok("no rule consults a calendar day or a timezone",
   !/getFullYear|getMonth|getDate|Intl|timeZone/.test(readFileSync("lib/drop-schedule.ts", "utf8")));

// ── 2. Source parity ────────────────────────────────────────────────────────
section("The real implementation matches this mirror");
const src = readFileSync("lib/drop-schedule.ts", "utf8");
ok("validateDropSchedule is exported", /export function validateDropSchedule/.test(src));
ok("assertValidDropSchedule throws", /export function assertValidDropSchedule/.test(src) && /throw new Error/.test(src));
ok("firstScheduleError is exported", /export function firstScheduleError/.test(src));
ok("close-after-open uses a strict comparison", /closesAt <= opensAt/.test(src));
ok("pickup-end-after-start uses a strict comparison", /pickupEndAt <= pickupStartAt/.test(src));
ok("pickup-after-close allows equality", /pickupStartAt < closesAt/.test(src));
ok("nothing here mutates a date", !/set(FullYear|Month|Date|Hours|Minutes|Time)\(/.test(src));
ok("the module is client-importable (not server-only)", !/server-only/.test(src));

const actions = readFileSync("lib/actions/dashboard.ts", "utf8");
ok("createDropAction validates before creating",
   /assertValidDropSchedule[\s\S]{0,400}?prisma\.drop\.create/.test(actions));
ok("updateDropFullAction validates before updating",
   /assertValidDropSchedule[\s\S]{0,600}?prisma\.drop\.update/.test(actions));
ok("both drop write paths are gated", (actions.match(/assertValidDropSchedule\(/g) || []).length === 2);
ok("the update path validates resolved values, not just submitted ones",
   /opensAt = formData\.get\("opensAt"\) \? new Date\(String\(formData\.get\("opensAt"\)\)\) : drop\.opensAt/.test(actions));

const editor = readFileSync("components/drop-editor.tsx", "utf8");
ok("the editor imports the shared rules", /firstScheduleError.*@\/lib\/drop-schedule/s.test(editor));
ok("the editor blocks submit via preventDefault (React skips the action)",
   /scheduleError[\s\S]{0,120}e\.preventDefault\(\)/.test(editor));
ok("the editor no longer hand-rolls the ordering comparisons",
   !/closes <= opens/.test(editor) && !/pEnd <= pStart/.test(editor));

// ── 3. Read-only production sweep ──────────────────────────────────
//
// Two drops were created on 2026-06-17 (PDT), before the editor had any
// ordering check — it was a pair of bare, optional <input type="datetime-local">
// fields — and before any server gate existed. They are deliberately NOT
// repaired: inventing a close date for a drop that already took and fulfilled
// a real order would be fabricating history. They are pinned here instead.
//
// Each entry pins the EXACT problem, so this sweep fails when:
//   • a drop outside this list is invalid   → the server gate has a hole
//   • a pinned drop develops a NEW problem   → a fresh defect on a known record
//   • a pinned drop is repaired or deleted   → the entry is stale, remove it
// The last case fails on purpose. A repair is good news, but leaving a dead
// exception in place is how a list like this silently stops protecting you.
const GRANDFATHERED = new Map([
  ["cmqiv6npn0001jj045uvdw4tr", { title: "Frog Incense Holder",   signature: "closesAt:close_before_open" }],
  ["cmqivo0co0001ju047ygclfhh", { title: "Papel picado coasters", signature: "closesAt:half_open_order_window" }],
]);

section("Production drop schedules (READ ONLY)");
try {
  const { PrismaClient } = await import("../app/generated/prisma/index.js");
  const prisma = new PrismaClient();
  const drops = await prisma.drop.findMany({
    select: { id: true, title: true, status: true, opensAt: true, closesAt: true,
              pickupStartAt: true, pickupEndAt: true, _count: { select: { orders: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byId = new Map(drops.map((d) => [d.id, d]));
  const invalid = drops.filter((d) => !valid(d));
  console.log(`  ${drops.length} drops, ${invalid.length} invalid, ${GRANDFATHERED.size} grandfathered`);
  for (const d of invalid) {
    const known = GRANDFATHERED.has(d.id) ? "grandfathered" : "UNEXPECTED";
    console.log(`    [${known}] "${d.title}" (${d.id}) status=${d.status} orders=${d._count.orders}`);
    for (const i of validateDropSchedule(d)) console.log(`      - ${i.field}: ${i.message}`);
  }
  ok("every drop classifies without throwing", drops.length > 0);

  // 1. Nothing invalid outside the pinned list. This is the assertion that
  //    catches a hole in the server gate.
  const unexpected = invalid.filter((d) => !GRANDFATHERED.has(d.id));
  ok("no invalid drop outside the grandfathered list", unexpected.length === 0,
     unexpected.map((d) => `"${d.title}" (${d.id}) — ${signature(d)}`).join("; "));

  // 2. Each pinned record still exists, is still invalid, and is invalid in
  //    exactly the way recorded. Any drift is surfaced, never masked.
  for (const [id, expected] of GRANDFATHERED) {
    const d = byId.get(id);
    const label = `grandfathered "${expected.title}"`;
    if (!d) {
      ok(`${label} still exists`, false,
         `record ${id} is gone. If it was deleted on purpose, drop this entry from GRANDFATHERED.`);
      continue;
    }
    const actual = signature(d);
    if (actual === "") {
      ok(`${label} is still unrepaired`, false,
         `it is now VALID — the record was fixed. Good news: delete this entry from GRANDFATHERED so the list stays honest.`);
      continue;
    }
    ok(`${label} still has exactly its known problem`, actual === expected.signature,
       `expected "${expected.signature}", found "${actual}"`);
  }

  // 3. The business rule holds everywhere, pinned records included — neither
  //    known exception involves a pickup window.
  ok("no production drop violates the pickup-after-close rule",
     drops.every((d) => !(d.closesAt && d.pickupStartAt && d.pickupStartAt < d.closesAt)));

  await prisma.$disconnect();
} catch (e) {
  console.log(`  ! skipped DB check: ${e.message}`);
}

console.log(`\n${failures.length === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${failures.length} failed`);
if (failures.length) { failures.forEach((f) => console.log(`  - ${f}`)); process.exit(1); }
