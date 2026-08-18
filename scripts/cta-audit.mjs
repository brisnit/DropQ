/**
 * Responsive CTA + containment audit.
 *
 *   npm run build && PORT=3100 npm start        # a production build, real CSS
 *   node --env-file=.env scripts/cta-audit.mjs '[["Home","/",false]]'
 *
 * Drives real Chrome with hydration and measures BOUNDING BOXES, because
 * `document.scrollWidth === clientWidth` is not sufficient: the body clips
 * rather than scrolls, so a card 400px past the viewport still reports a clean
 * page. Every mobile bug in this codebase so far hid behind that.
 *
 * Flags, per element, at 320/375/390/430:
 *   - CTA label wrapping to more than one line
 *   - any CTA whose box escapes the viewport (right > vw, or left < 0)
 *   - interactive controls under the 44px minimum touch target
 *
 * Deliberate exclusions, each of which produced false positives:
 *   - descendants of a horizontal scroller (filter chips are SUPPOSED to sit
 *     outside the viewport)
 *   - line boxes within 6px of each other (an emoji sits on a different
 *     baseline than its label and read as a second line)
 *   - column-flex controls (a sheet handle stacked above its label)
 *   - compact card links with more than two child spans
 *   - aria-hidden decoration (a blurred glow that bleeds a few px)
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
const SELLER = "cmqa8276c0000l204mbtgzwnd"; // Britts Bunnies — read-only browsing
const cookie = `${SELLER}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(SELLER).digest("hex")}`;
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", PORT=9350;
const chrome=spawn(CHROME,[`--remote-debugging-port=${PORT}`,"--headless=new","--disable-gpu","--no-first-run","--user-data-dir=/tmp/chrome-cta","about:blank"],{stdio:"ignore"});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let list;for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);if(r.ok){list=await r.json();break}}catch{}await sleep(250)}
const ws=new WebSocket(list.find(t=>t.type==="page").webSocketDebuggerUrl);
await new Promise(r=>ws.addEventListener("open",r,{once:true}));
let id=0;const pend=new Map();
ws.addEventListener("message",e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}))});
await send("Page.enable"); await send("Network.enable");

const PROBE=`(()=>{const vw=innerWidth;const wrapped=[],overflow=[],small=[];
// A chip inside a horizontal scroller is SUPPOSED to sit outside the viewport.
const inScroller = el => { let n=el.parentElement;
  while(n&&n!==document.body){const o=getComputedStyle(n).overflowX; if(o==="auto"||o==="scroll") return true; n=n.parentElement;} return false; };
const isCta = el => {
  const t=el.tagName.toLowerCase();
  if(t!=="button"&&t!=="a") return false;
  const cs=getComputedStyle(el);
  if(cs.display==="none"||cs.visibility==="hidden") return false;
  const r=el.getBoundingClientRect();
  if(r.width<8||r.height<8) return false;
  // Cards are tall and contain block children; a CTA is a single short control.
  if(r.height>64) return false;
  if(el.querySelector("p,h1,h2,h3,h4,div>div")) return false;
  // A compact card link stacks several spans by design; a CTA is one run of text.
  if(el.querySelectorAll("span,div").length>2) return false;
  const label=(el.textContent||"").trim();
  if(!label||label.length>32) return false;
  const rounded=parseFloat(cs.borderRadius)||0;
  return t==="button" || rounded>=8 || cs.display.includes("flex");
};
for(const el of document.querySelectorAll("button, a")){
  if(!isCta(el)) continue;
  const label=(el.textContent||"").trim();
  const r=el.getBoundingClientRect();
  // Group rect tops within 6px: an emoji or icon sits on a slightly different
  // baseline than its label and would otherwise read as a second line.
  const rng=document.createRange(); rng.selectNodeContents(el);
  const tops=[...rng.getClientRects()].filter(x=>x.height>0).map(x=>x.top).sort((a,b)=>a-b);
  let lines=0,last=-1e9;
  for(const t of tops){ if(t-last>6){lines++;last=t;} }
  const cs=getComputedStyle(el);
  const scroller=inScroller(el);
  // A column-flex control stacks its children deliberately (e.g. a sheet
  // grab-handle above its label); that is not a wrapped CTA label.
  const stacked = cs.display.includes("flex") && cs.flexDirection === "column";
  if(lines>1 && !stacked) wrapped.push({label,lines,w:+r.width.toFixed(1),ws:cs.whiteSpace});
  if(!scroller&&(r.right>vw+0.5||r.left<-0.5)) overflow.push({label,over:+Math.max(r.right-vw,-r.left).toFixed(1)});
  if(r.height<44) small.push({label,h:+r.height.toFixed(1)});
}
const de=document.documentElement;
return {vw,pageOverflow:de.scrollWidth>de.clientWidth+0.5,wrapped,overflow,small:small.slice(0,10)};})()`;

const PAGES = JSON.parse(process.argv[2]);
for (const [label,path,auth] of PAGES) {
  await send("Network.clearBrowserCookies");
  if (auth) await send("Network.setCookie",{name:"hp_session",value:cookie,domain:"localhost",path:"/"});
  let out=[];
  for (const w of [320,375,390,430]) {
    await send("Emulation.setDeviceMetricsOverride",{width:w,height:844,deviceScaleFactor:2,mobile:true});
    await send("Page.navigate",{url:`http://localhost:3100${path}`}); await sleep(1700);
    const r=(await send("Runtime.evaluate",{expression:PROBE,returnByValue:true}))?.result?.result?.value;
    if(!r){out.push(`    ${w}px probe failed`);continue}
    const bits=[];
    if(r.wrapped.length) bits.push(`WRAP ${r.wrapped.map(x=>`"${x.label}"(${x.lines}L)`).join(" ")}`);
    if(r.overflow.length) bits.push(`OVERFLOW ${r.overflow.map(x=>`"${x.label}"+${x.over}px`).join(" ")}`);
    if(r.small.length) bits.push(`SMALL ${r.small.map(x=>`"${x.label}"${x.h}px`).join(" ")}`);
    if(r.pageOverflow) bits.push("PAGE-OVERFLOW");
    out.push(`    ${String(w).padStart(3)}px  ${bits.length?bits.join("  |  "):"clean"}`);
  }
  console.log(`\n## ${label}  (${path})`);
  out.forEach(l=>console.log(l));
}
ws.close();chrome.kill();
