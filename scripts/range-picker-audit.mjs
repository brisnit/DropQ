/**
 * Range-picker interaction audit.
 *
 * The date picker's selection rules are pure state transitions, so they look
 * obviously correct when you read them — which is exactly why they need to be
 * driven rather than reviewed. This clicks the real page and reads the hidden
 * inputs the form would actually submit, not the rendered summary (which is
 * derived from the same state and would happily agree with a wrong value).
 *
 * TWO TRAPS this script exists to document, both of which produced convincing
 * false bug reports before it existed:
 *
 * 1. React batches state updates within one synchronous tick. Two `.click()`
 *    calls in a single evaluate() both read the SAME pre-click state, so the
 *    second behaves like a first click and the range collapses to one day.
 *    That is what "both Opens and Closes became the later date" was — a
 *    screenshot script, not a defect. A human cannot click twice in one tick.
 *    Scenario F asserts this artifact deliberately so it is never re-reported
 *    as a bug. The same trap eats month-nav clicks; see nextOnce().
 *
 * 2. The stored value is a UTC instant. Comparing its UTC date part is wrong:
 *    a 17:00 close in Los Angeles is 00:00 the NEXT day in UTC, so a correct
 *    single-day drop reads as spanning two. Compare the calendar day in the
 *    STORE's zone.
 *
 * Needs a production build on :3100 and a seller to log in as. Read-only: it
 * fills a form and never submits it.
 *
 *   node --env-file=.env scripts/range-picker-audit.mjs
 *
 * Optional: TZ_OVERRIDE=Pacific/Kiritimati forces the BROWSER's zone away from
 * the store's, which must change nothing.
 */
import { spawn } from "node:child_process"; import crypto from "node:crypto";
const S="cmqa8276c0000l204mbtgzwnd";
const cookie=`${S}.${crypto.createHmac("sha256",process.env.SESSION_SECRET).update(S).digest("hex")}`;
const P=Number(process.env.CDP||9471), CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
spawn(CHROME,[`--remote-debugging-port=${P}`,"--headless=new","--no-first-run",`--user-data-dir=/tmp/r-${P}`,"about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let list;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${P}/json/list`);if(r.ok){list=await r.json();if(list.some(t=>t.type==="page"))break}}catch{}await sleep(300)}
const ws=new WebSocket(list.find(t=>t.type==="page").webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener("open",r,{once:true}));
let id=0;const pend=new Map();
ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
const ev=async(expr)=>{const r=await send("Runtime.evaluate",{returnByValue:true,expression:expr});
  if(r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,300));
  return r.result?.result?.value;};
await send("Page.enable");await send("Network.enable");
await send("Network.setCookie",{name:"hp_session",value:cookie,domain:"localhost",path:"/"});
if (process.env.TZ_OVERRIDE) await send("Emulation.setTimezoneOverride",{timezoneId:process.env.TZ_OVERRIDE});

const PICKERS = [
  { label: "Order Window",  start:"opensAt",       end:"closesAt"      },
  { label: "Pickup Window", start:"pickupStartAt", end:"pickupEndAt"   },
];

const reset = async () => { await send("Page.navigate",{url:"http://localhost:3100/dashboard/drops/new"}); await sleep(2400); };
/** Every day-grid in DOM order: [orderWindow, pickupWindow]. */
const GRIDS = `[...document.querySelectorAll('.grid.grid-cols-7')].filter(g=>g.querySelector('button'))`;
const clickDay = (p, day) => ev(`(()=>{const g=${GRIDS}[${p}];
  const b=[...g.querySelectorAll('button')].find(x=>x.textContent.trim().replace(/\\D/g,'')==='${day}');
  if(!b) throw new Error('no day ${day}'); b.click(); return true;})()`);
const shiftMonth = (p, dir) => ev(`(()=>{const card=${GRIDS}[${p}].closest('.rounded-card')||${GRIDS}[${p}].parentElement;
  const navs=[...card.querySelectorAll('button')].filter(b=>['‹','›'].includes(b.textContent.trim()));
  navs[${dir==="next"?1:0}].click(); return true;})()`);
const read = (p) => ev(`(()=>{const n=(k)=>document.querySelector('input[name="'+k+'"]')?.value??null;
  const g=${GRIDS}[${p}]; const sel=[...g.querySelectorAll('button')].filter(b=>/bg-brand text-white/.test(b.querySelector('span')?.className||'')).map(b=>b.textContent.trim().replace(/\\D/g,''));
  const banded=[...g.children].filter(d=>/bg-brand-tint/.test(d.className)).length;
  return {start:n('${PICKERS[p].start}'), end:n('${PICKERS[p].end}'), selected:sel, bandedCells:banded};})()`);
const stepMonth = (p) => ev(`(()=>{const c=${GRIDS}[${p}].closest('.rounded-card')||${GRIDS}[${p}].parentElement;
  const nav=[...c.querySelectorAll('button')].filter(b=>['‹','›'].includes(b.textContent.trim()))[1];
  nav.click(); return true;})()`);
const monthLabel = (p) => ev(`(()=>{const card=${GRIDS}[${p}].closest('.rounded-card')||${GRIDS}[${p}].parentElement;
  return card.querySelector('select')?.value ?? null;})()`);

// The stored value is a UTC instant. Comparing its UTC date part is WRONG:
// a 17:00 close in Los Angeles is 00:00 the NEXT day in UTC, which makes a
// correct single-day drop look like it spans two. Compare the calendar day in
// the STORE's zone, which is the day the vendor actually picked.
const STORE_TZ = process.env.STORE_TZ || "America/Los_Angeles";
const day = (iso) => iso ? new Intl.DateTimeFormat("en-CA",
  { timeZone: STORE_TZ, year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date(iso)) : null;
/** Wall-clock time in the store's zone — proves the offset was applied. */
const wall = (iso) => iso ? new Intl.DateTimeFormat("en-GB",
  { timeZone: STORE_TZ, hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(iso)) : null;
const results = [];
const record = (name, pass, detail) => { results.push({name,pass,detail}); };

await reset();
const todayNum = await ev(`document.querySelector('[aria-current="date"]').textContent.trim().replace(/\\D/g,'')`);
const daysInMonth = await ev(`(()=>{const g=${GRIDS}[0];return [...g.querySelectorAll('button')].length})()`);
console.log(`  today = day ${todayNum} of a ${daysInMonth}-day month`);
// "later" must be FORWARD. Past days are disabled, so a backward target would
// click a dead button and the scenario would quietly assert nothing — which is
// exactly what happened the first time the month rolled past today+4.
const roomThisMonth = Number(todayNum) < daysInMonth;
const later = roomThisMonth ? Math.min(Number(todayNum) + 4, daysInMonth) : 5;
const laterIsNextMonth = !roomThisMonth;
/** Click the "later" day, stepping to next month when today is month-end. */
const clickLater = async (p) => {
  if (laterIsNextMonth) { await stepMonth(p); await sleep(450); }
  await clickDay(p, later);
};

for (let p = 0; p < PICKERS.length; p++) {
  const L = PICKERS[p].label;
  console.log(`\n## ${L}`);

  // --- A: today -> later date -------------------------------------------
  await reset(); await clickDay(p, todayNum); await sleep(350); await clickLater(p); await sleep(450);
  let r = await read(p);
  console.log(`  A today(${todayNum}) -> later(${later})          start=${day(r.start)} ${wall(r.start)}  end=${day(r.end)} ${wall(r.end)}  selected=[${r.selected}] band=${r.bandedCells}`);
  record(`${L}: today -> later sets Opens=today and Closes=later`,
    day(r.start).endsWith(`-${String(todayNum).padStart(2,"0")}`)
      && day(r.end).endsWith(`-${String(later).padStart(2,"0")}`)
      && r.selected.includes(String(todayNum)) && r.selected.includes(String(later))
      && r.bandedCells > 2 && wall(r.start)==="09:00" && wall(r.end)==="17:00",
    JSON.stringify({...r, sd:day(r.start), ed:day(r.end)}));

  // --- B: future -> later future (next month, fully controlled) ----------
  await reset(); await shiftMonth(p,"next"); await sleep(500);
  await clickDay(p, 5); await sleep(350); await clickDay(p, 12); await sleep(450);
  r = await read(p);
  console.log(`  B future(5) -> later future(12)       start=${day(r.start)} ${wall(r.start)}  end=${day(r.end)} ${wall(r.end)}  selected=[${r.selected}] band=${r.bandedCells}`);
  record(`${L}: future -> later future spans both dates`,
    day(r.start).endsWith("-05") && day(r.end).endsWith("-12")
      && r.selected.includes("5") && r.selected.includes("12") && r.bandedCells > 2,
    JSON.stringify({...r, sd:day(r.start), ed:day(r.end)}));

  // --- C: today -> same day ---------------------------------------------
  await reset(); await clickDay(p, todayNum); await sleep(350); await clickDay(p, todayNum); await sleep(450);
  r = await read(p);
  console.log(`  C today -> same day                   start=${day(r.start)} ${wall(r.start)}  end=${day(r.end)} ${wall(r.end)}  selected=[${r.selected}]`);
  record(`${L}: same day twice stays a single-day drop`,
    day(r.start) === day(r.end) && day(r.start).endsWith(`-${String(todayNum).padStart(2,"0")}`)
      && wall(r.start)==="09:00" && wall(r.end)==="17:00",
    JSON.stringify({...r, sd:day(r.start), ed:day(r.end)}));

  // --- D: later -> earlier ----------------------------------------------
  await reset(); await shiftMonth(p,"next"); await sleep(500);
  await clickDay(p, 20); await sleep(350); await clickDay(p, 8); await sleep(450);
  r = await read(p);
  console.log(`  D later(20) -> earlier(8)             start=${day(r.start)} ${wall(r.start)}  end=${day(r.end)} ${wall(r.end)}  selected=[${r.selected}]`);
  record(`${L}: an earlier second click restarts at that day`,
    r.selected.includes("8") && !r.selected.includes("20")
      && day(r.start) === day(r.end) && day(r.start).endsWith("-08"),
    JSON.stringify({...r, sd:day(r.start), ed:day(r.end)}));

  // --- E: new start after a completed range ------------------------------
  await reset(); await shiftMonth(p,"next"); await sleep(500);
  await clickDay(p, 5); await sleep(350); await clickDay(p, 12); await sleep(400);
  await clickDay(p, 22); await sleep(450);
  r = await read(p);
  console.log(`  E range(5-12) then new start(22)      start=${day(r.start)} ${wall(r.start)}  end=${day(r.end)} ${wall(r.end)}  selected=[${r.selected}]`);
  record(`${L}: a click after a completed range starts fresh`,
    r.selected.includes("22") && !r.selected.includes("5") && !r.selected.includes("12")
      && day(r.start)===day(r.end) && day(r.start).endsWith("-22"),
    JSON.stringify({...r, sd:day(r.start), ed:day(r.end)}));

  // --- G: a past day must be inert ---------------------------------------
  // Ghosting is only half of it. If the button still fires, a vendor can
  // schedule a drop that opened last week and nothing on the page objects.
  await reset();
  const pastDay = Number(todayNum) > 3 ? Number(todayNum) - 3 : null;
  if (pastDay) {
    const wasDisabled = await ev(`(()=>{const b=[...${GRIDS}[${p}].querySelectorAll('button')]
      .find(x=>x.textContent.trim().replace(/\\D/g,'')==='${pastDay}'); return b ? b.disabled : null;})()`);
    await clickDay(p, pastDay); await sleep(450);
    r = await read(p);
    console.log(`  G click a PAST day (${pastDay})               start=${day(r.start)} end=${day(r.end)} selected=[${r.selected}] disabledAttr=${wasDisabled}`);
    record(`${L}: a past day is disabled`, wasDisabled === true, `disabled=${wasDisabled}`);
    record(`${L}: clicking a past day selects nothing`,
      r.start === "" && r.end === "" && r.selected.length === 0, JSON.stringify(r));
    // And today, one boundary step away, must still work.
    await clickDay(p, todayNum); await sleep(450);
    r = await read(p);
    record(`${L}: today is still selectable next to the disabled range`,
      r.selected.includes(String(todayNum)), JSON.stringify(r));
  }

  // --- F: the same-tick double click (what the screenshot script did) ----
  await reset();
  if (laterIsNextMonth) { await stepMonth(p); await sleep(450); }
  await ev(`(()=>{const g=${GRIDS}[${p}]; const bs=[...g.querySelectorAll('button')].filter(b=>!b.disabled);
    const t=bs.find(x=>x.textContent.trim().replace(/\\D/g,'')==='${laterIsNextMonth ? later : todayNum}');
    const l=bs.find(x=>x.textContent.trim().replace(/\\D/g,'')==='${later}');
    t.click(); l.click(); return true;})()`);
  await sleep(600);
  r = await read(p);
  console.log(`  F both clicks in ONE tick             start=${day(r.start)} ${wall(r.start)}  end=${day(r.end)} ${wall(r.end)}  selected=[${r.selected}]   <-- reproduces the screenshot artifact`);
  record(`${L}: same-tick double click collapses to the later day (React batching, not user-reachable)`,
    day(r.start) === day(r.end) && day(r.start).endsWith(`-${String(later).padStart(2,"0")}`),
    JSON.stringify({...r, sd:day(r.start), ed:day(r.end)}));
}


const TZ=STORE_TZ;
const fmt=(iso,o)=>new Intl.DateTimeFormat("en-GB",{timeZone:TZ,...o}).format(new Date(iso));
const offset=(iso)=>{const s=new Intl.DateTimeFormat("en-US",{timeZone:TZ,timeZoneName:"shortOffset"}).format(new Date(iso));return s.split(" ").pop();};
const G=GRIDS;

// One click per tick. Looping clicks inside a single evaluate() batches them
// into a single state update and shifts the month once, no matter how many
// times you call click() — the same effect that produced the original
// "both dates became the later date" screenshot.
const nextOnce=(p)=>ev(`(()=>{const c=${G}[${p}].closest('.rounded-card')||${G}[${p}].parentElement;
  const nav=[...c.querySelectorAll('button')].filter(b=>['‹','›'].includes(b.textContent.trim()))[1];
  nav.click(); return true;})()`);
const next=async(p,n)=>{ for(let i=0;i<n;i++){ await nextOnce(p); await sleep(450);} };
const month=(p)=>ev(`(()=>{const c=${G}[${p}].closest('.rounded-card')||${G}[${p}].parentElement;
  return [...c.querySelectorAll('select')].map(s=>s.value).join(" ");})()`);
const clickD=(p,d)=>ev(`(()=>{const b=[...${G}[${p}].querySelectorAll('button')].find(x=>x.textContent.trim().replace(/\\D/g,'')==='${d}');
  if(!b) throw new Error('no day ${d}'); b.click(); return true;})()`);
const readOW=()=>ev(`({start:document.querySelector('input[name="opensAt"]').value,end:document.querySelector('input[name="closesAt"]').value})`);

const dstChecks=[];
const show=(label,r)=>{
  const line=`  ${label.padEnd(34)} start=${fmt(r.start,{dateStyle:"medium"})} ${fmt(r.start,{hour:"2-digit",minute:"2-digit",hour12:false})} ${offset(r.start)}   end=${fmt(r.end,{dateStyle:"medium"})} ${fmt(r.end,{hour:"2-digit",minute:"2-digit",hour12:false})} ${offset(r.end)}`;
  console.log(line); return r;
};
const ok=(n,p,d)=>dstChecks.push({n,p,d});

// Aug -> Oct (2 shifts): both sides still PDT.
await reset(); await next(0,2); console.log("   view:", await month(0)); await clickD(0,25); await sleep(400); await clickD(0,28); await sleep(500);
let r=show("Oct 25 -> Oct 28 (both PDT)", await readOW());
ok("pre-DST range keeps 09:00/17:00 wall clock",
  fmt(r.start,{hour:"2-digit",minute:"2-digit",hour12:false})==="09:00" && fmt(r.end,{hour:"2-digit",minute:"2-digit",hour12:false})==="17:00", JSON.stringify(r));
ok("pre-DST range is stored at UTC-7", offset(r.start)==="GMT-7" && offset(r.end)==="GMT-7", `${offset(r.start)}/${offset(r.end)}`);

// Aug -> Nov (3 shifts): both sides PST.
await reset(); await next(0,3); console.log("   view:", await month(0)); await clickD(0,15); await sleep(400); await clickD(0,20); await sleep(500);
r=show("Nov 15 -> Nov 20 (both PST)", await readOW());
ok("post-DST range keeps 09:00/17:00 wall clock",
  fmt(r.start,{hour:"2-digit",minute:"2-digit",hour12:false})==="09:00" && fmt(r.end,{hour:"2-digit",minute:"2-digit",hour12:false})==="17:00", JSON.stringify(r));
ok("post-DST range is stored at UTC-8", offset(r.start)==="GMT-8" && offset(r.end)==="GMT-8", `${offset(r.start)}/${offset(r.end)}`);

// A range that SPANS the Nov 1 transition — the two ends need DIFFERENT offsets.
await reset(); await next(0,2); console.log("   view:", await month(0)); await clickD(0,30); await sleep(400);
await next(0,1); await sleep(700); await clickD(0,5); await sleep(500);
r=show("Oct 30 -> Nov 5 (spans PDT->PST)", await readOW());
ok("a range spanning DST still reads 09:00 -> 17:00 locally",
  fmt(r.start,{hour:"2-digit",minute:"2-digit",hour12:false})==="09:00" && fmt(r.end,{hour:"2-digit",minute:"2-digit",hour12:false})==="17:00", JSON.stringify(r));
ok("each end of a DST-spanning range gets its own offset",
  offset(r.start)==="GMT-7" && offset(r.end)==="GMT-8", `${offset(r.start)} -> ${offset(r.end)}`);
ok("the DST-spanning range is the right calendar days",
  fmt(r.start,{month:"short",day:"numeric"})==="30 Oct" && fmt(r.end,{month:"short",day:"numeric"})==="5 Nov",
  `${fmt(r.start,{month:"short",day:"numeric"})} -> ${fmt(r.end,{month:"short",day:"numeric"})}`);


console.log("\n## Daylight-saving boundaries (store zone " + STORE_TZ + ")");
for (const c of dstChecks) if (!c.p) results.push({name:"DST: "+c.n, pass:false, detail:c.d});
for (const c of dstChecks) if (c.p) results.push({name:"DST: "+c.n, pass:true});

console.log("");
const failed = results.filter(r=>!r.pass);
for (const f of failed) console.log(`  FAIL: ${f.name} — ${f.detail}`);
console.log(failed.length
  ? `FAILED: ${results.length-failed.length} passed, ${failed.length} failed`
  : `ALL PASS: ${results.length} passed, 0 failed`);
process.exit(failed.length ? 1 : 0);
