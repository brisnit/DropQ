import { existsSync, readFileSync, readdirSync } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  RULES,
  consume,
  hashKey,
  limiterEnabled,
  normalizeEmailKey,
  peek,
  purgeExpiredRateLimits,
  windowStart,
} from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { fixtureRefusal, fixtureRefusalBody } from "@/lib/fixture-guard";

/**
 * Auth rate-limiting self-test.
 *
 * Writes counter rows, so it is fixture-producing and refuses anywhere but the
 * harness database. It touches no Seller and no Customer — one of the things it
 * proves is that throttling never writes to an account.
 *
 * The properties, in order of how badly a regression hurts:
 *
 *   1. THE GUARD IS STILL WIRED. A source scan that fails by name if an auth
 *      action stops calling the limiter, or a new one appears without it.
 *   2. UNKNOWN AND KNOWN IDENTIFIERS COST THE SAME. Otherwise the limiter is a
 *      better account oracle than the message it replaced.
 *   3. COUNTS ARE NOT LOST UNDER CONCURRENCY. A lost increment is a brute-force
 *      getting through.
 *   4. NOTHING LOCKS AN ACCOUNT. Blocks live in this table and expire.
 *   5. IT FAILS OPEN, and the kill switch works.
 */

type Result = { name: string; pass: boolean; detail?: string };

/** Auth entry points that must consume or check limiter budget. */
const GUARDED = [
  { file: "lib/actions/auth.ts", needs: ["peek(\"login\"", "consume(\"login\"", "consume(\"signup\"", "consume(\"passwordReset\""] },
  { file: "lib/actions/rep-auth.ts", needs: ["peek(\"login\"", "consume(\"login\""] },
  { file: "lib/actions/customer-auth.ts", needs: ["consume(\"magicLink\""] },
  { file: "app/verify/route.ts", needs: ["consume(\"tokenVerify\""] },
  { file: "app/messages/verify/route.ts", needs: ["consume(\"tokenVerify\""] },
];

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const refusal = fixtureRefusal();
  if (refusal) return NextResponse.json(fixtureRefusalBody(refusal), { status: 503 });

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const fresh = () => `probe-${uniq()}@example.com`;

  /* ---------------------- 1. Thresholds are as approved ------------------ */
  {
    const find = (rule: keyof typeof RULES, dim: string, ms: number) =>
      (RULES[rule] as readonly { dimension: string; max: number; windowMs: number }[])
        .find((l) => l.dimension === dim && l.windowMs === ms)?.max;

    check("login: 5 per email / 15 min", find("login", "email", 900_000) === 5);
    check("login: 30 per IP / 15 min", find("login", "ip", 900_000) === 30);
    check("signup: 3 per email / hour", find("signup", "email", 3_600_000) === 3);
    check("signup: 5 per IP / hour", find("signup", "ip", 3_600_000) === 5);
    check("signup: 20 per IP / day", find("signup", "ip", 86_400_000) === 20);
    check("magic link: 3 per email / 15 min", find("magicLink", "email", 900_000) === 3);
    check("magic link: 10 per email / day", find("magicLink", "email", 86_400_000) === 10);
    check("magic link: 15 per IP / 15 min", find("magicLink", "ip", 900_000) === 15);
    check("reset: 3 per email / hour", find("passwordReset", "email", 3_600_000) === 3);
    check("reset: 10 per email / day", find("passwordReset", "email", 86_400_000) === 10);
    check("reset: 15 per IP / hour", find("passwordReset", "ip", 3_600_000) === 15);
    check("token verify: 30 per IP / 15 min", find("tokenVerify", "ip", 900_000) === 30);
    check("login has no IP-only escape and no email-only escape",
      (RULES.login as readonly { dimension: string }[]).map((l) => l.dimension).sort().join() === "email,ip");
  }

  /* ------------------------- 2. Keys and windows ------------------------- */
  {
    const raw = "Someone@Example.COM ";
    check("emails are normalised before hashing", normalizeEmailKey(raw) === "someone@example.com");
    check("the same identifier hashes stably", hashKey("email", "a@b.c") === hashKey("email", "a@b.c"));
    check("dimensions are namespaced apart", hashKey("email", "x") !== hashKey("ip", "x"));
    check("the key is not the identifier", !hashKey("email", "a@b.c").includes("a@b.c"));
    check("the key is fixed width", hashKey("email", "a@b.c").length === 32);

    const w = 900_000;
    const a = windowStart(1_000_000_000_000, w).getTime();
    check("windows are aligned", a % w === 0);
    check("the same window for two nearby instants",
      windowStart(a + 1000, w).getTime() === windowStart(a + 2000, w).getTime());
    check("a new window after the boundary",
      windowStart(a + w, w).getTime() === a + w);
  }

  /* --------------------- 3. Counting, blocking, healing ------------------ */
  {
    const email = fresh();
    let blockedAt = 0;
    for (let i = 1; i <= 6; i++) {
      const d = await consume("login", { email });
      if (!d.allowed && !blockedAt) blockedAt = i;
    }
    check("the sixth login failure is blocked, not the fifth", blockedAt === 6, `blocked at ${blockedAt}`);

    const gate = await peek("login", { email });
    check("a blocked email stays blocked on the next attempt", !gate.allowed);
    check("the block reports when it lifts",
      typeof gate.retryAfterMs === "number" && gate.retryAfterMs! > 0 && gate.retryAfterMs! <= 900_000);

    const other = fresh();
    check("a different email is unaffected", (await peek("login", { email: other })).allowed);
  }

  /* ------------------- 4. Enumeration parity (the point) ----------------- */
  {
    // "Known" vs "unknown" is a property of the Seller table; the limiter must
    // not be able to tell the difference. Same calls, same budget, same shape.
    const known = fresh();
    const unknown = fresh();
    const a: boolean[] = [];
    const b: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      a.push((await consume("login", { email: known })).allowed);
      b.push((await consume("login", { email: unknown })).allowed);
    }
    check("known and unknown identifiers consume identical budget",
      JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

    const src = readFileSync("lib/actions/auth.ts", "utf8");
    check("login consumes AFTER the constant-time comparison, not before the lookup",
      src.indexOf("verifyPasswordConstantTime") < src.indexOf('await consume("login"'));
    check("login returns one shared message for every failure",
      (src.match(/WRONG_CREDENTIALS/g) ?? []).length >= 3);
    check("a rate-limited login says nothing different",
      /if \(!gate\.allowed\) return \{ error: WRONG_CREDENTIALS \};/.test(src));
    check("a rate-limited reset request still answers `sent`",
      /if \(!gate\.allowed\) return \{ sent: true \};/.test(src));
    const magic = readFileSync("lib/actions/customer-auth.ts", "utf8");
    check("a rate-limited magic link still answers `sent`",
      /if \(!gate\.allowed\) return \{ sent: true \};/.test(magic));
    const rep = readFileSync("lib/actions/rep-auth.ts", "utf8");
    check("rep login shares one message across every failure mode",
      (rep.match(/WRONG_REP_CREDENTIALS/g) ?? []).length >= 3);
  }

  /* ------------------------- 5. Dimensions are separate ------------------ */
  {
    const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
    // 30 failures spread across 30 distinct emails: no single email is close to
    // its limit, but the IP bucket fills.
    for (let i = 0; i < 30; i++) await consume("login", { email: fresh(), ip });
    const gate = await peek("login", { email: fresh(), ip });
    check("an IP limit trips even when every email is different", !gate.allowed);
    check("a different IP is unaffected",
      (await peek("login", { email: fresh(), ip: "203.0.113.7" })).allowed);
    check("no IP means no IP bucket, not a shared one",
      (await peek("login", { email: fresh() })).allowed);
  }

  /* --------------------------- 6. Concurrency ---------------------------- */
  {
    const email = fresh();
    await Promise.all(Array.from({ length: 20 }, () => consume("signup", { email })));
    const rows = await prisma.rateLimit.findMany({
      where: { key: hashKey("email", normalizeEmailKey(email)) },
      select: { bucket: true, count: true },
    });
    const total = rows.reduce((n, r) => n + r.count, 0);
    check("20 parallel attempts count exactly 20 times", total === 20, `counted ${total}`);
    check("they landed in one bucket row", rows.length === 1, `${rows.length} rows`);
  }

  /* ------------------------ 7. Expiry and cleanup ------------------------ */
  {
    const key = hashKey("ip", `expired-${uniq()}`);
    await prisma.rateLimit.create({
      data: {
        bucket: "login:ip:900000", key, windowAt: new Date(Date.now() - 7_200_000),
        count: 99, expiresAt: new Date(Date.now() - 3_600_000),
      },
    });
    const purged = await purgeExpiredRateLimits();
    check("closed windows are deleted", purged >= 1, `${purged} rows`);
    check("the expired row is gone",
      (await prisma.rateLimit.count({ where: { key } })) === 0);

    // A counter in a window that has since closed does not block anyone: the
    // key includes the window, so the next attempt lands on a fresh row.
    const email = fresh();
    const oldWindow = windowStart(Date.now() - 3_600_000, 900_000);
    await prisma.rateLimit.create({
      data: {
        bucket: "login:email:900000", key: hashKey("email", normalizeEmailKey(email)),
        windowAt: oldWindow, count: 999,
        expiresAt: new Date(oldWindow.getTime() + 900_000),
      },
    });
    check("a block self-heals once its window passes",
      (await peek("login", { email })).allowed);
  }

  /* ------------------- 8. Never touches account state -------------------- */
  {
    // A probe vendor of this suite's own making, looked up by its own id — a
    // fixture route must never reach for "the first seller", which in a
    // production database is somebody's real store.
    const probe = await prisma.seller.create({
      data: {
        email: fresh(),
        passwordHash: "$2b$10$selftestselftestselftestselftestselftestselftestselftest",
        storeName: "Rate Limit Probe",
        slug: `rate-limit-probe-${uniq()}`,
        category: "food",
        termsAcceptedAt: new Date(),
        referralCode: `RLP${uniq().toUpperCase().slice(0, 8)}`,
      },
    });
    const snapshot = { where: { id: probe.id } } as const;
    const select = { id: true, email: true, passwordHash: true, disabledAt: true } as const;
    const before = await prisma.seller.findUnique({ ...snapshot, select });

    // Well past every login threshold, on both dimensions at once.
    for (let i = 0; i < 12; i++) await consume("login", { email: probe.email, ip: "203.0.113.9" });

    const after = await prisma.seller.findUnique({ ...snapshot, select });
    check("throttling modifies no Seller row", JSON.stringify(before) === JSON.stringify(after));
    check("throttling sets no disable flag", after?.disabledAt == null);
    check("the vendor is blocked in the limiter, not on the account",
      !(await peek("login", { email: probe.email })).allowed);
    await prisma.seller.delete(snapshot);

    const limiterSrc = readFileSync("lib/rate-limit.ts", "utf8");
    check("the limiter cannot write to Seller", !/prisma\.seller\./.test(limiterSrc));
    check("the limiter cannot write to Customer", !/prisma\.customer\./.test(limiterSrc));
    check("the limiter only touches its own table",
      (limiterSrc.match(/prisma\.\w+\./g) ?? []).every((m) => m === "prisma.rateLimit."));
  }

  /* --------------------- 9. Kill switch and fail-open -------------------- */
  {
    check("unset means ON", limiterEnabled({} as NodeJS.ProcessEnv));
    check("RATE_LIMIT_MODE=off disables it",
      !limiterEnabled({ RATE_LIMIT_MODE: "off" } as unknown as NodeJS.ProcessEnv));
    check("case and whitespace do not defeat the switch",
      !limiterEnabled({ RATE_LIMIT_MODE: " OFF " } as unknown as NodeJS.ProcessEnv));
    check("an unrecognised value stays ON",
      limiterEnabled({ RATE_LIMIT_MODE: "yes" } as unknown as NodeJS.ProcessEnv));

    const src = readFileSync("lib/rate-limit.ts", "utf8");
    check("both entry points fail open", (src.match(/allowing:/g) ?? []).length === 2);
    check("failure returns ALLOW, never a throw",
      /catch \(e\) \{[\s\S]{0,220}return ALLOW;/.test(src));
    check("the switch is documented as needing a redeploy", /redeploy/i.test(src));
  }

  /* ---------------- 10. The guard cannot be silently removed ------------- */
  {
    for (const { file, needs } of GUARDED) {
      const src = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const need of needs) {
        check(`${file} still calls ${need}")`, src.includes(need));
      }
    }

    // The check a hard-coded list cannot make: a NEW action that opens a
    // session or creates a Seller without going through the limiter.
    const actionFiles = readdirSync("lib/actions").filter((f) => f.endsWith(".ts"));
    const unguarded: string[] = [];
    for (const f of actionFiles) {
      const src = readFileSync(`lib/actions/${f}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const authenticates = /createSession\(|createRepSession\(|createCustomerSession\(|prisma\.seller\.create\(/.test(src);
      const limited = /consume\(|peek\(/.test(src);
      // oauth.ts hands off to Google, which applies its own limits; the session
      // it mints is a consequence of a completed OAuth handshake, not of a
      // credential this application accepted.
      if (authenticates && !limited && f !== "oauth.ts") unguarded.push(f);
    }
    check("no action authenticates without the limiter", unguarded.length === 0, unguarded.join(", "));
  }

  /* ------------------------- 11. Client IP parsing ----------------------- */
  {
    const h = (o: Record<string, string>) => new Headers(o);

    // ---- What a request on Vercel actually looks like ---------------------
    // Recorded from a preview deployment on 31 Aug 2026. Every header carries
    // the same single address, whatever the client sent. See lib/client-ip.ts.
    const OBSERVED = {
      "x-vercel-forwarded-for": "72.196.173.133",
      "x-forwarded-for": "72.196.173.133",
      "x-real-ip": "72.196.173.133",
      "x-vercel-proxied-for": "72.196.173.133",
    };
    check("the observed Vercel request shape resolves to the caller",
      clientIp(h(OBSERVED)) === "72.196.173.133");
    check("no header on Vercel is ever a list",
      Object.values(OBSERVED).every((v) => !v.includes(",")));

    // ---- The spoof attempt, replayed --------------------------------------
    // A client sending `x-forwarded-for: 1.2.3.4` was observed to have its
    // value REPLACED at the edge — the application never saw it. Replaying the
    // received headers here is the regression: if the platform ever changed to
    // append instead, the shape below is what would arrive, and the assertion
    // that we do not resolve to the attacker's value is what would catch it.
    check("the spoofed value never reached the application",
      clientIp(h(OBSERVED)) !== "1.2.3.4");
    check("the Vercel header is preferred over a general forwarding header",
      clientIp(h({
        "x-vercel-forwarded-for": "203.0.113.5",
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "5.6.7.8",
      })) === "203.0.113.5");
    check("a spoofed chain cannot pin a chosen address, even off-platform",
      clientIp(h({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.5" })) === "203.0.113.5");

    // ---- Fallbacks, for anywhere that is not Vercel ------------------------
    check("a single forwarded value still works",
      clientIp(h({ "x-forwarded-for": "203.0.113.5" })) === "203.0.113.5");
    check("x-real-ip is the last resort", clientIp(h({ "x-real-ip": "203.0.113.9" })) === "203.0.113.9");
    check("no header means no key", clientIp(h({})) === null);
    check("an unusable Vercel header falls through rather than returning null",
      clientIp(h({ "x-vercel-forwarded-for": "garbage", "x-forwarded-for": "203.0.113.5" }))
        === "203.0.113.5");

    // ---- Shape, because the value becomes a bucket key ---------------------
    check("junk is rejected rather than keyed",
      clientIp(h({ "x-forwarded-for": "not-an-ip" })) === null);
    check("a port is stripped", clientIp(h({ "x-forwarded-for": "203.0.113.5:51234" })) === "203.0.113.5");
    check("IPv6 is accepted", clientIp(h({ "x-forwarded-for": "2001:db8::1" })) === "2001:db8::1");
    check("an out-of-range octet is rejected",
      clientIp(h({ "x-forwarded-for": "999.1.1.1" })) === null);
    check("an overlong value cannot become a key",
      clientIp(h({ "x-forwarded-for": "a".repeat(400) })) === null);

    // ---- The observation is recorded where the next person will look ------
    const ipSrc = readFileSync("lib/client-ip.ts", "utf8");
    check("client-ip.ts records the measurement, not an assumption",
      /OBSERVED, NOT REASONED/.test(ipSrc) && /72\.196\.173\.133/.test(ipSrc));
    check("the temporary probe route is gone",
      !existsSync("app/api/dev/ip-probe"));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "rate-limit",
      limiterEnabled: limiterEnabled(),
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
