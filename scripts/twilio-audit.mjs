/**
 * Twilio readiness audit — READ ONLY.
 *
 *   node --env-file=.env scripts/twilio-audit.mjs
 *
 * Answers "can DropQ actually send a text right now, and if not, what's
 * blocking it?" by querying the Twilio REST API with the credentials already
 * in the environment. Every call is a GET. It never sends a message, never
 * buys a number, and never changes registration state — sending from an
 * unregistered number can incur carrier violation fees, so that stays a
 * deliberate manual step.
 */

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const MG = process.env.TWILIO_MESSAGING_SERVICE_SID;
const FROM = process.env.TWILIO_FROM_NUMBER;

if (!SID || !TOKEN) {
  console.error(
    "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN.\n\n" +
      "They live in Vercel, not your local .env. Pull them:\n" +
      "  vercel link          # once, if the project isn't linked\n" +
      "  vercel env pull .env.vercel.local\n" +
      "  node --env-file=.env.vercel.local scripts/twilio-audit.mjs\n"
  );
  process.exit(1);
}

const auth = "Basic " + Buffer.from(`${SID}:${TOKEN}`).toString("base64");

async function get(url) {
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: `HTTP ${res.status}`, detail: body?.message ?? null };
    return body;
  } catch (e) {
    return { error: e.message };
  }
}

const ok = (s) => `  ✓ ${s}`;
const bad = (s) => `  ✗ ${s}`;
const warn = (s) => `  ! ${s}`;
const blockers = [];
const todo = [];

console.log("\n════ TWILIO READINESS AUDIT ════\n");

// ── Account ────────────────────────────────────────────────────────────────
const acct = await get(`https://api.twilio.com/2010-04-01/Accounts/${SID}.json`);
console.log("ACCOUNT");
if (acct.error) {
  console.log(bad(`Could not read the account: ${acct.error}. Credentials may be wrong.`));
  blockers.push("Twilio credentials are not valid");
} else {
  console.log(`  ${acct.friendly_name}  ·  ${acct.sid}`);
  console.log(`  status: ${acct.status}   type: ${acct.type}`);
  if (acct.type === "Trial") {
    console.log(bad("TRIAL account — can only text numbers you've verified, and every message is prefixed with a trial notice."));
    blockers.push("Upgrade off the trial account");
  } else {
    console.log(ok("Full (paid) account"));
  }
  if (acct.status !== "active") {
    console.log(bad(`Account status is "${acct.status}", not active.`));
    blockers.push(`Account is ${acct.status}`);
  }
}

// ── Numbers ────────────────────────────────────────────────────────────────
console.log("\nPHONE NUMBERS");
const nums = await get(
  `https://api.twilio.com/2010-04-01/Accounts/${SID}/IncomingPhoneNumbers.json?PageSize=50`
);
const numbers = nums?.incoming_phone_numbers ?? [];
if (!numbers.length) {
  console.log(bad("No phone numbers on the account."));
  blockers.push("Buy a phone number (10DLC local, or toll-free)");
} else {
  for (const n of numbers) {
    const smsOk = n.capabilities?.sms;
    const kind = n.phone_number?.match(/^\+1(800|833|844|855|866|877|888)/) ? "toll-free" : "10DLC/local";
    console.log(`  ${n.phone_number}  (${kind})  sms=${smsOk ? "yes" : "NO"}`);
    if (!smsOk) console.log(warn(`${n.phone_number} cannot send SMS`));
  }
}

// ── Messaging Services ─────────────────────────────────────────────────────
console.log("\nMESSAGING SERVICES");
const svcs = await get("https://messaging.twilio.com/v1/Services?PageSize=50");
const services = svcs?.services ?? [];
if (!services.length) {
  console.log(bad("No Messaging Service. A2P campaigns attach to a Messaging Service, so one is required."));
  blockers.push("Create a Messaging Service and add your number to its sender pool");
} else {
  for (const s of services) {
    const isConfigured = s.sid === MG;
    console.log(`  ${s.friendly_name}  ·  ${s.sid}${isConfigured ? "   <-- TWILIO_MESSAGING_SERVICE_SID" : ""}`);
    const pool = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/PhoneNumbers`);
    const senders = pool?.phone_numbers ?? [];
    console.log(`     senders in pool: ${senders.length}${senders.length ? " (" + senders.map((p) => p.phone_number).join(", ") + ")" : ""}`);
    if (!senders.length) {
      console.log(warn("No numbers in this service's sender pool — sends will fail with error 21703."));
      if (isConfigured) blockers.push("Add your phone number to the Messaging Service sender pool");
    }

    // A2P campaign attached to this service
    const camp = await get(`https://messaging.twilio.com/v1/Services/${s.sid}/Compliance/Usa2p`);
    if (camp?.error) {
      console.log(warn("No A2P campaign attached to this Messaging Service."));
      if (isConfigured) blockers.push("Register an A2P 10DLC campaign for this Messaging Service");
    } else if (Array.isArray(camp?.compliance) ? camp.compliance.length === 0 : !camp?.sid) {
      console.log(warn("No A2P campaign found on this service."));
      if (isConfigured) blockers.push("Register an A2P 10DLC campaign for this Messaging Service");
    } else {
      const c = Array.isArray(camp.compliance) ? camp.compliance[0] : camp;
      console.log(`     campaign: ${c.campaign_status ?? c.status ?? "unknown"}  use case: ${c.us_app_to_person_usecase ?? "?"}`);
      if ((c.campaign_status ?? "").toUpperCase() !== "VERIFIED") {
        if (isConfigured) blockers.push(`A2P campaign is "${c.campaign_status}" — must be VERIFIED to send`);
      }
    }
  }
}

// ── A2P 10DLC brand ────────────────────────────────────────────────────────
console.log("\nA2P 10DLC BRAND");
const brands = await get("https://messaging.twilio.com/v1/a2p/BrandRegistrations?PageSize=20");
const brandList = brands?.data ?? brands?.brand_registrations ?? [];
if (!brandList.length) {
  console.log(bad("No brand registered. A2P 10DLC requires a brand before a campaign."));
  blockers.push("Register your A2P 10DLC brand (EIN, legal name, address, website)");
} else {
  for (const b of brandList) {
    console.log(`  ${b.brand_type ?? "brand"}  status: ${b.status}${b.identity_status ? "  identity: " + b.identity_status : ""}`);
    if (b.failure_reason) console.log(bad(`failure: ${b.failure_reason}`));
    if (b.status !== "APPROVED") blockers.push(`Brand registration is "${b.status}", not APPROVED`);
  }
}

// ── Toll-free verification ─────────────────────────────────────────────────
console.log("\nTOLL-FREE VERIFICATION");
const tf = await get("https://messaging.twilio.com/v1/Tollfree/Verifications?PageSize=20");
const tfList = tf?.verifications ?? [];
if (!tfList.length) {
  console.log("  none submitted (fine if you're going the 10DLC route)");
} else {
  for (const v of tfList) {
    console.log(`  ${v.tollfree_phone_number}  status: ${v.status}`);
    if (v.rejection_reason) console.log(bad(`rejected: ${v.rejection_reason}`));
  }
}

// ── Recent traffic ─────────────────────────────────────────────────────────
console.log("\nRECENT MESSAGES (last 20)");
const msgs = await get(
  `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?PageSize=20`
);
const list = msgs?.messages ?? [];
if (!list.length) {
  console.log("  no messages sent yet");
} else {
  const byStatus = {};
  const errors = {};
  for (const m of list) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    if (m.error_code) errors[`${m.error_code}: ${m.error_message ?? ""}`] = (errors[`${m.error_code}: ${m.error_message ?? ""}`] ?? 0) + 1;
  }
  console.log("  " + Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join("  "));
  for (const [e, n] of Object.entries(errors)) console.log(bad(`${n}× ${e}`));
}

// ── App config ─────────────────────────────────────────────────────────────
console.log("\nDROPQ APP CONFIG");
console.log(`  TWILIO_MESSAGING_SERVICE_SID  ${MG ? "set (" + MG + ")" : "NOT SET"}`);
console.log(`  TWILIO_FROM_NUMBER            ${FROM ? "set (" + FROM + ")" : "not set"}`);
console.log(
  `  MESSAGING_SMS_ENABLED         ${process.env.MESSAGING_SMS_ENABLED === "true" ? "true — messaging notifications WILL send" : "not true — messaging notifications stay off"}`
);
if (!MG && !FROM) blockers.push("Set TWILIO_MESSAGING_SERVICE_SID in Vercel");
if (!MG && FROM) {
  console.log(warn("Using a bare From number. A2P requires sending through the Messaging Service — set TWILIO_MESSAGING_SERVICE_SID."));
  todo.push("Switch from TWILIO_FROM_NUMBER to TWILIO_MESSAGING_SERVICE_SID");
}
if (process.env.MESSAGING_SMS_ENABLED !== "true") {
  todo.push("Set MESSAGING_SMS_ENABLED=true once the campaign is VERIFIED");
}

// ── Verdict ────────────────────────────────────────────────────────────────
console.log("\n════ VERDICT ════");
if (blockers.length === 0) {
  console.log("  ✓ Nothing blocking. Transactional order texts should send.");
} else {
  console.log("  Blocking issues, in the order to fix them:\n");
  [...new Set(blockers)].forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
}
if (todo.length) {
  console.log("\n  Then:");
  [...new Set(todo)].forEach((t) => console.log(`   • ${t}`));
}
console.log("");
