import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { TERMS_VERSION } from "@/lib/terms";

/**
 * Development-only cover for the "today" treatment in the Drop date picker
 * (`components/date-range-picker.tsx`, rendered twice by `components/drop-editor.tsx`).
 *
 * Two things are being protected here, and only one of them is cosmetic.
 *
 * 1. WHICH day is today. Every other date in that picker is interpreted in the
 *    seller's store timezone, but `today` was read from the rendering clock's
 *    zone. That was invisible while `today` only picked the opening view month;
 *    the moment it paints a cell, a vendor whose device (or our server) sits in
 *    a different zone gets the wrong day highlighted. So the fixtures below use
 *    two zones a day apart at most instants — Pacific/Kiritimati (UTC+14) and
 *    Pacific/Niue (UTC-11) — and assert the highlighted day equals what `Intl`
 *    says that store's date is, independently of the process's own zone.
 *
 * 2. That today, selected, and today-AND-selected stay three distinguishable
 *    states. A regression here is silent: a selection style that simply paints
 *    over the today style still looks perfectly fine in a screenshot.
 *
 * Renders the real authenticated pages over HTTP. Fixtures are torn down in a
 * `finally` and every tracked count is asserted back to baseline. Nothing here
 * touches Stripe, orders or the drop lifecycle.
 */

type Check = { name: string; pass: boolean; detail?: string };

const TRACKED: Record<string, () => Promise<number>> = {
  drop: () => prisma.drop.count(),
  seller: () => prisma.seller.count(),
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The store's own calendar date, computed the way the picker must. */
function dateInZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "long",
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: map.weekday,
    label: `${map.weekday}, ${MONTHS[Number(map.month) - 1]} ${Number(map.day)}, ${Number(map.year)} (today)`,
  };
}

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

  /** Every `<button>` in the markup that claims to be today. */
  const todayCells = (html: string) =>
    html.match(/<button[^>]*aria-current="date"[\s\S]{0,900}?<\/button>/g) ?? [];

  const makeSeller = (tz: string, key: string) =>
    prisma.seller.create({
      data: {
        email: `datepicker-${key}-${stamp}@example.com`,
        slug: `datepicker-${key}-${stamp}`,
        storeName: `Date Picker ${key}`,
        passwordHash: "x",
        internalKind: "selftest",
        timezone: tz,
        // Without these the dashboard renders the Vendor Agreement gate and
        // every assertion below silently inspects that instead.
        termsAcceptedAt: new Date(),
        termsVersion: TERMS_VERSION,
      },
      select: { id: true },
    });

  try {
    // ---- 1. The highlighted day follows the STORE's zone, not the clock's ----
    // Two zones 25 hours apart. At most instants these disagree about the date,
    // so a picker that quietly used the process's own `new Date()` cannot
    // satisfy both assertions at once.
    for (const [key, tz] of [["east", "Pacific/Kiritimati"], ["west", "Pacific/Niue"]] as const) {
      const s = await makeSeller(tz, key);
      created[key] = s.id;
      const expected = dateInZone(tz);

      const page = await get("/dashboard/drops/new", s.id);
      check(`${tz}: new-drop page renders`, page.status === 200, `status=${page.status}`);

      const cells = todayCells(page.body);
      // Two pickers on the page — the order window and the pickup window — and
      // exactly one today cell in each.
      check(`${tz}: both date pickers mark exactly one day as today`,
        cells.length === 2, `aria-current cells=${cells.length}`);

      const labels = cells.map((c) => c.match(/aria-label="([^"]+)"/)?.[1] ?? "");
      check(`${tz}: the highlighted day is the store's date (${expected.day} ${expected.weekday})`,
        labels.length > 0 && labels.every((l) => l === expected.label),
        `expected="${expected.label}" got=${JSON.stringify(labels)}`);

      check(`${tz}: today is announced to screen readers as today`,
        labels.every((l) => l.endsWith("(today)")));
      check(`${tz}: today is visually marked without relying on colour alone`,
        cells.every((c) => /ring-1 ring-brand-dark/.test(c) && /rounded-full/.test(c) && /bg-brand-dark/.test(c)),
        cells[0]?.slice(0, 200));
      // brand (#ff6268) on paper is 2.92:1 — under AA for 14px bold text. The
      // day number must stay ink; the ring and dot carry today in brand-dark
      // (3.69:1, over the 3:1 non-text indicators need).
      check(`${tz}: the today number keeps AA-contrast ink, not coral`,
        cells.every((c) => /text-ink font-semibold/.test(c) && !/text-brand[" ]/.test(c)));
      check(`${tz}: today is not painted as a selected date on a blank form`,
        cells.every((c) => !/bg-brand text-white/.test(c)));
      check(`${tz}: a legend explains the marker`, page.body.includes(">Today<"));
    }

    // ---- 2. Today AND selected is its own state, not one overwriting the other ----
    const tz = "Pacific/Kiritimati";
    const expected = dateInZone(tz);
    // Midday in the store's own zone, so the stored instant lands on that
    // store's "today" no matter what the server's zone is.
    const opens = new Date(
      `${expected.year}-${String(expected.month).padStart(2, "0")}-${String(expected.day).padStart(2, "0")}T12:00:00+14:00`,
    );
    const drop = await prisma.drop.create({
      data: {
        sellerId: created.east!,
        title: "Date Picker Selftest Drop",
        status: "draft",
        mode: "preorder",
        fulfillment: "pickup",
        opensAt: opens,
        closesAt: new Date(opens.getTime() + 3 * 24 * 3600 * 1000),
      },
      select: { id: true },
    });
    created.drop = drop.id;

    const edit = await get(`/dashboard/drops/${drop.id}/edit`, created.east!);
    check("edit page renders", edit.status === 200, `status=${edit.status}`);

    const cells = todayCells(edit.body);
    const combined = cells.filter((c) => /bg-brand text-white/.test(c));
    check("when today is also the selected date, one cell carries both states",
      combined.length === 1, `today cells=${cells.length} also-selected=${combined.length}`);
    check("the selection fill wins so the selected date still reads as selected",
      combined[0] !== undefined && /bg-brand text-white font-semibold/.test(combined[0]));
    check("the today marker survives the selection fill (dot flips to white)",
      combined[0] !== undefined && /bg-white/.test(combined[0]),
      combined[0]?.slice(0, 260));
    check("the combined cell is still announced as today",
      combined[0] !== undefined && /aria-current="date"/.test(combined[0])
        && (combined[0].match(/aria-label="([^"]+)"/)?.[1] ?? "").endsWith("(today)"));

    // The other picker (pickup window) has no selection here, so it must still
    // show the plain today state — proving the two states are independent.
    check("an unselected picker on the same page still shows plain today",
      cells.some((c) => !/bg-brand text-white/.test(c) && /ring-1 ring-brand-dark/.test(c)));

    // ---- 3. Source guards --------------------------------------------------
    const src = readFileSync("components/date-range-picker.tsx", "utf8");
    check("today is derived in the seller's timezone, not the rendering clock's",
      /function todayInZone/.test(src) && /todayInZone\(timeZone\)/.test(src)
        && !/const today = useMemo\(\(\) => new Date\(\), \[\]\)/.test(src));
    check("todayInZone recomputes if the store timezone changes",
      /useMemo\(\(\) => todayInZone\(timeZone\), \[timeZone\]\)/.test(src));
    check("day cells are keyboard-focus visible",
      /focus-visible:ring-2/.test(src));
    check("every day cell has a spoken date, not just a bare number",
      /aria-label=\{`\$\{WEEKDAYS_LONG/.test(src));
    check("the today dot is decorative to screen readers",
      /aria-hidden\s*\n?\s*className=\{\[\s*\n?\s*"absolute bottom-1/.test(src)
        || /isToday && \(\s*<span\s*\n\s*aria-hidden/.test(src));

    const editorSrc = readFileSync("components/drop-editor.tsx", "utf8");
    const pickers = editorSrc.match(/<DateRangePicker[\s\S]*?\/>/g) ?? [];
    check("every Drop date picker is passed the store timezone",
      pickers.length === 2 && pickers.every((p) => /timeZone=\{timeZone\}/.test(p)),
      `pickers=${pickers.length}`);
  } catch (e) {
    check("selftest ran without an unexpected exception", false,
      e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : String(e));
  } finally {
    const attempt = async (fn: () => Promise<unknown>) => { try { await fn(); } catch { /* baseline catches it */ } };
    if (created.drop) await attempt(() => prisma.drop.delete({ where: { id: created.drop } }));
    for (const id of [created.east, created.west].filter(Boolean) as string[]) {
      await attempt(() => prisma.seller.delete({ where: { id } }));
    }
    for (const [m, count] of Object.entries(TRACKED)) {
      const now = await count();
      check(`teardown restored ${m} to baseline`, now === baseline[m], `${baseline[m]} -> ${now}`);
    }
  }

  const failed = checks.filter((c) => !c.pass);
  return NextResponse.json({
    suite: "date-picker-selftest",
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  });
}
