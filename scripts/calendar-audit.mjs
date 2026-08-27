/**
 * Geometric regression check for the Drop date picker and the emoji popover.
 *
 * The selftest suites assert markup; they cannot see a 27px-wide tap target,
 * because the class that produces it (`w-9` on a grid child that is allowed to
 * shrink) looks perfectly correct in the source. Only a real layout tells you
 * how wide the cell actually ended up. Same for the emoji popover: it is
 * absolutely positioned, so it overflows the viewport WITHOUT overflowing the
 * document — `scrollWidth === clientWidth` stays true the whole time.
 *
 * Needs a production build on :3100 (`npm run build && PORT=3100 npm start`)
 * and a seller to log in as. Read-only: it browses, it never submits.
 *
 *   node --env-file=.env scripts/calendar-audit.mjs
 *
 * 44x44 is not reachable at 320px and the check knows it. Seven columns need
 * 308px; the dashboard shell alone spends 40px of a 320px viewport before the
 * calendar's own card is drawn. Below 375px the bar is the height plus as much
 * width as the arithmetic allows, and the width floor there is a regression
 * guard, not the target.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";

const SELLER = "cmqa8276c0000l204mbtgzwnd"; // Britts Bunnies — read-only browsing
const cookie = `${SELLER}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(SELLER).digest("hex")}`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CDP || 9401);
const WIDTHS = [320, 375, 390, 430, 1280];
const TARGET = 44;          // the touch target we want everywhere it fits
const NARROW_FLOOR = 38;    // what 320px can physically give; see header

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, "--headless=new",
  "--disable-gpu", "--no-first-run", `--user-data-dir=/tmp/cal-audit-${PORT}`, "about:blank"], { stdio: "ignore" });

let list;
for (let i = 0; i < 80; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    if (r.ok) { list = await r.json(); if (list.some((t) => t.type === "page")) break; } } catch {}
  await sleep(300);
}
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { returnByValue: true, expression, awaitPromise: false });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text ?? "probe threw");
  return r.result?.result?.value;
};

await send("Page.enable"); await send("Network.enable");
await send("Network.setCookie", { name: "hp_session", value: cookie, domain: "localhost", path: "/" });

const CALENDAR = `(() => {
  const vw = innerWidth;
  const grids = [...document.querySelectorAll('.grid.grid-cols-7')];
  const days = [...document.querySelectorAll('.grid.grid-cols-7 button')];
  if (!days.length) return { error: 'no day cells found' };
  const rects = days.map((d) => d.getBoundingClientRect());
  const circles = days.map((d) => d.querySelector('span')?.getBoundingClientRect()).filter(Boolean);
  const cards = [...document.querySelectorAll('.grid.grid-cols-7')].map((g) => {
    const c = g.closest('.rounded-card') || g.parentElement;
    const r = c.getBoundingClientRect();
    return { left: +r.left.toFixed(1), right: +r.right.toFixed(1) };
  });
  const today = document.querySelector('[aria-current="date"]');
  const de = document.documentElement;
  return {
    vw, grids: grids.length, days: days.length,
    minW: +Math.min(...rects.map((r) => r.width)).toFixed(1),
    minH: +Math.min(...rects.map((r) => r.height)).toFixed(1),
    circle: circles.length ? Math.round(circles[0].width) + 'x' + Math.round(circles[0].height) : null,
    todayCells: document.querySelectorAll('[aria-current="date"]').length,
    todayHasRing: !!(today && /ring-brand-dark/.test(today.querySelector('span')?.className ?? '')),
    cardsInside: cards.every((c) => c.left >= -0.5 && c.right <= vw + 0.5),
    cardWorst: cards.length ? Math.max(...cards.map((c) => c.right - vw)) : 0,
    docOverflow: de.scrollWidth - de.clientWidth,
  };
})()`;

const EMOJI = `(() => {
  const vw = innerWidth;
  const ds = [...document.querySelectorAll('details')];
  ds.forEach((d) => { d.open = true; });
  const pops = [];
  for (const d of ds) {
    const pop = d.querySelector('.grid');
    if (!pop) continue;
    const r = pop.getBoundingClientRect();
    if (!r.width) continue;
    const kids = [...pop.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
    pops.push({
      inside: r.left >= -0.5 && r.right <= vw + 0.5,
      kidsInside: kids.every((k) => k.left >= -0.5 && k.right <= vw + 0.5),
      worst: +Math.max(r.right - vw, -r.left).toFixed(1),
      w: Math.round(r.width),
    });
  }
  const de = document.documentElement;
  return { vw, n: pops.length, pops, docOverflow: de.scrollWidth - de.clientWidth };
})()`;

const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); };

// The library's picker only exists once a product form is open.
const OPEN_FORM = `(() => { for (const b of document.querySelectorAll('button'))
  if (/new product|add (a )?product/i.test(b.textContent || '')) { b.click(); return true; } return false; })()`;

for (const [label, path, prep] of [
  ["drops/new", "/dashboard/drops/new", null],
  ["products", "/dashboard/products", OPEN_FORM],
]) {
  console.log(`\n## ${label}`);
  for (const w of WIDTHS) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 500 });
    await send("Page.navigate", { url: `http://localhost:3100${path}` });
    await sleep(2300);
    if (prep) { await evaluate(prep); await sleep(900); }

    if (label === "drops/new") {
      const c = await evaluate(CALENDAR);
      if (c.error) { check(`${label} ${w}: calendar present`, false, c.error); continue; }
      const wantW = w >= 375 ? TARGET : NARROW_FLOOR;
      check(`${label} ${w}: day cells are >= ${TARGET}px tall`, c.minH >= TARGET, `${c.minH}px`);
      check(`${label} ${w}: day cells are >= ${wantW}px wide`, c.minW >= wantW, `${c.minW}px`);
      check(`${label} ${w}: both pickers render`, c.grids === 4 && c.days >= 56, `grids=${c.grids} days=${c.days}`);
      check(`${label} ${w}: the day circle is still 36px`, c.circle === "36x36", String(c.circle));
      check(`${label} ${w}: today is marked in both pickers`, c.todayCells === 2 && c.todayHasRing,
        `cells=${c.todayCells} ring=${c.todayHasRing}`);
      check(`${label} ${w}: no calendar-card overflow`, c.cardsInside, `worst right-edge overshoot ${c.cardWorst.toFixed(1)}px`);
      check(`${label} ${w}: no document overflow`, c.docOverflow === 0, `${c.docOverflow}px`);
      console.log(`  ${String(w).padStart(4)}px  hit-area ${String(c.minW).padStart(5)} x ${c.minH}  circle=${c.circle}  cardsInside=${c.cardsInside}  docOverflow=${c.docOverflow}`);
    }

    const e = await evaluate(EMOJI);
    check(`${label} ${w}: an emoji popover was found`, e.n > 0, `n=${e.n}`);
    check(`${label} ${w}: emoji popover stays inside the viewport`,
      e.pops.every((p) => p.inside), e.pops.map((p) => `overshoot ${p.worst}px`).join(", "));
    check(`${label} ${w}: every emoji button stays inside the viewport`,
      e.pops.every((p) => p.kidsInside));
    check(`${label} ${w}: opening the popover does not scroll the document`, e.docOverflow === 0, `${e.docOverflow}px`);
    console.log(`  ${String(w).padStart(4)}px  emoji popovers=${e.n} width=${e.pops.map((p) => p.w).join("/")} inside=${e.pops.every((p) => p.inside)}`);
  }
}

const failed = checks.filter((c) => !c.pass);
console.log("");
for (const f of failed) console.log(`  FAIL: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
console.log(failed.length ? `\nFAILED: ${checks.length - failed.length} passed, ${failed.length} failed`
                          : `\nALL PASS: ${checks.length} passed, 0 failed`);
chrome.kill();
process.exit(failed.length ? 1 : 0);
