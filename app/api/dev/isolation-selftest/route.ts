import { readdirSync, readFileSync, existsSync } from "node:fs";
import { NextResponse } from "next/server";
import {
  FIXTURE_DB,
  FIXTURE_HOST,
  FIXTURE_PORT,
  fixtureRefusal,
  fixtureRefusalBody,
  fixturesAllowed,
} from "@/lib/fixture-guard";
import { isUnambiguous, retentionCutoff, utc, utcDay, utcWindow } from "@/lib/utc";

/**
 * Test isolation self-test — "a self-test can never again write to production".
 *
 *   curl localhost:3000/api/dev/isolation-selftest
 *
 * Read-only: no database, no network, no writes. Safe against production, which
 * is the point — this is the suite that proves the OTHER suites are not.
 *
 * THE REGRESSION IT EXISTS TO CATCH. On 2026-08-30 five self-test routes were
 * discovered to be creating fixtures in the production database, because
 * `npm run dev` loads a `.env` that points there. Two separate teardown bugs
 * left 8 vendors and 14 customers behind. The guard added in response is one
 * import and one early return per route — trivially easy for a future developer
 * to delete while debugging and never put back.
 *
 * So this suite reads the routes' SOURCE. If someone removes the guard, or adds
 * a sixth fixture-producing route without one, a check here fails by name.
 */

type Result = { name: string; pass: boolean; detail?: string };

/** Routes that create application records and must therefore be guarded. */
const FIXTURE_ROUTES = [
  "attribution-selftest",
  "checkout-minimum-selftest",
  "date-picker-selftest",
  "messaging-selftest",
  "rate-limit-selftest",
  "security-headers-selftest",
  "walkup-pay-selftest",
  "walkup-route-selftest",
];

/** Prisma models whose creation makes a route fixture-producing. */
const RECORD_MODELS =
  /prisma\.(seller|customer|customerAccount|drop|product|order|orderItem|walkUpSale|customerVendor|vendorProduct|subscriber|rateLimit|cspReport)\.(create|createMany|upsert)/;

const PRODUCTION_URL =
  "postgresql://user:pw@ep-rough-cake-atlwek15.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require";
const FIXTURE_URL = `postgresql://dropq_test:dropq_test@${FIXTURE_HOST}:${FIXTURE_PORT}/${FIXTURE_DB}`;

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) =>
    results.push({ name, pass, ...(detail ? { detail } : {}) });

  /* ------------------- 1. The guard refuses production ------------------- */
  {
    const refuse = (env: Record<string, string | undefined>) => fixtureRefusal(env);

    check("production database is refused",
      refuse({ DATABASE_URL: PRODUCTION_URL })?.reason === "not_the_fixture_database");
    check("the real production host is named in the refusal",
      (refuse({ DATABASE_URL: PRODUCTION_URL })?.detail ?? "").includes("neon.tech"));

    check("preview is refused even pointed at the fixture database",
      refuse({ VERCEL_ENV: "preview", DATABASE_URL: FIXTURE_URL })?.reason === "hosted_environment");
    check("preview pointed at production is refused",
      refuse({ VERCEL_ENV: "preview", DATABASE_URL: PRODUCTION_URL })?.reason === "hosted_environment");
    check("production deployment is refused",
      refuse({ VERCEL_ENV: "production", DATABASE_URL: FIXTURE_URL })?.reason === "hosted_environment");
    check("any Vercel runtime is refused",
      refuse({ VERCEL: "1", DATABASE_URL: FIXTURE_URL })?.reason === "hosted_environment");
    check("a production build is refused",
      refuse({ NODE_ENV: "production", DATABASE_URL: FIXTURE_URL })?.reason === "production_build");

    /* -------------------- fails closed, never open ---------------------- */
    check("a missing DATABASE_URL fails closed",
      refuse({})?.reason === "no_database_url");
    check("an empty DATABASE_URL fails closed",
      refuse({ DATABASE_URL: "" })?.reason === "no_database_url");
    check("a malformed DATABASE_URL fails closed",
      refuse({ DATABASE_URL: "not a url at all" })?.reason === "unparseable_database_url");
    check("a URL with no host fails closed",
      refuse({ DATABASE_URL: "postgresql:///dropq_browser_test" }) !== null);
    check("the right database on the wrong host is refused",
      refuse({ DATABASE_URL: `postgresql://u:p@db.example.com:${FIXTURE_PORT}/${FIXTURE_DB}` })?.reason ===
        "not_the_fixture_database");
    check("the right host on the wrong port is refused",
      refuse({ DATABASE_URL: `postgresql://u:p@${FIXTURE_HOST}:5432/${FIXTURE_DB}` })?.reason ===
        "not_the_fixture_database");
    check("the right host and port with the wrong database is refused",
      refuse({ DATABASE_URL: `postgresql://u:p@${FIXTURE_HOST}:${FIXTURE_PORT}/dropq_dev` })?.reason ===
        "not_the_fixture_database");
    check("a database whose name merely contains the fixture name is refused",
      refuse({ DATABASE_URL: `postgresql://u:p@${FIXTURE_HOST}:${FIXTURE_PORT}/${FIXTURE_DB}_prod` }) !== null);

    /* ----------------------- and allows the one -------------------------- */
    check("the harness database is allowed", refuse({ DATABASE_URL: FIXTURE_URL }) === null);
    check("127.0.0.1 is allowed as the same machine",
      refuse({ DATABASE_URL: `postgresql://u:p@127.0.0.1:${FIXTURE_PORT}/${FIXTURE_DB}` }) === null);
    check("a refusal always explains the safe path",
      (fixtureRefusalBody(refuse({ DATABASE_URL: PRODUCTION_URL })!).remedy ?? "").includes("test:selftests"));
  }

  /* ------------- 2. Every fixture route actually uses the guard ---------- */
  {
    const devDir = "app/api/dev";
    const routes = readdirSync(devDir).filter((d) => existsSync(`${devDir}/${d}/route.ts`));
    check("the dev route directory is readable", routes.length >= 10, `${routes.length} routes`);

    // Strip comments so a mention of the guard in prose cannot satisfy the check.
    const bodyOf = (dir: string) =>
      readFileSync(`${devDir}/${dir}/route.ts`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

    for (const route of FIXTURE_ROUTES) {
      const src = bodyOf(route);
      check(`${route} imports the guard`, /from "@\/lib\/fixture-guard"/.test(src));
      check(`${route} calls the guard`, /fixtureRefusal\(\)/.test(src));
      check(`${route} returns before writing anything`,
        src.indexOf("fixtureRefusal()") > 0 &&
        (src.search(RECORD_MODELS) === -1 || src.indexOf("fixtureRefusal()") < src.search(RECORD_MODELS)));
      check(`${route} refuses with 503, not silently`, /status: 503/.test(src));
    }

    // The check that catches a NEW unguarded fixture route, which is the failure
    // mode a hard-coded list cannot see.
    const unguarded = routes.filter((dir) => {
      const src = bodyOf(dir);
      return RECORD_MODELS.test(src) && !/fixtureRefusal\(\)/.test(src);
    });
    check("no dev route creates records without the guard", unguarded.length === 0,
      unguarded.join(", "));

    // …and the inverse: a route that guards but never writes is a false alarm
    // that would train people to ignore the guard.
    const overGuarded = routes.filter((dir) => {
      const src = bodyOf(dir);
      return /fixtureRefusal\(\)/.test(src) && !RECORD_MODELS.test(src) && dir !== "isolation-selftest";
    });
    check("no read-only route is needlessly guarded", overGuarded.length === 0, overGuarded.join(", "));

    check("the guarded list matches what actually writes",
      FIXTURE_ROUTES.every((r) => RECORD_MODELS.test(bodyOf(r))),
      FIXTURE_ROUTES.filter((r) => !RECORD_MODELS.test(bodyOf(r))).join(", "));
  }

  /* --------------- 3. Read-only diagnostics stay production-safe --------- */
  {
    const readOnly = ["phase-a-selftest.mjs", "drop-schedule-selftest.mjs"];
    for (const file of readOnly) {
      // Strip comments AND string literals. These scripts make source
      // assertions about the app — phase-a searches lib/actions/order.ts for
      // the literal "prisma.order.create" to prove the sell gate runs before
      // any write — and a naive scan reads its own evidence as a violation.
      const src = readFileSync(`scripts/${file}`, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/"(?:[^"\\]|\\.)*"/g, '""')
        .replace(/'(?:[^'\\]|\\.)*'/g, "''")
        .replace(/`(?:[^`\\]|\\.)*`/g, "``");
      check(`scripts/${file} never writes`,
        !/prisma\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(src) &&
        !/\$executeRaw/.test(src));
      check(`scripts/${file} does not import the fixture guard`,
        !/fixture-guard/.test(src));
    }

    const guardSrc = readFileSync("lib/fixture-guard.ts", "utf8");
    check("the guard is server-only", /^import "server-only";/m.test(guardSrc));
    check("the guard checks the database, not just NODE_ENV",
      /DATABASE_URL/.test(guardSrc) && /VERCEL_ENV/.test(guardSrc));
    check("the guard has no escape hatch",
      !/FORCE|OVERRIDE|SKIP_GUARD|ALLOW_PRODUCTION/i.test(guardSrc));

    const runner = readFileSync("tests/selftests.mjs", "utf8");
    check("a runner exists that gives fixture suites a safe database",
      /startStack/.test(runner));
    check("the runner treats a refusal as a failure, not a skip",
      /fixtures_refused/.test(runner) && /failed\+\+/.test(runner));
    check("every fixture route is listed in the runner",
      FIXTURE_ROUTES.every((r) => runner.includes(r.replace("-selftest", ""))));
    check("every fixture route is marked as such in the runner",
      FIXTURE_ROUTES.every((r) => {
        const key = r.replace("-selftest", "");
        return new RegExp(`name: "${key}", fixtures: true`).test(runner);
      }));
    // activation and payments read real rows; on an empty database their
    // assertions are vacuous, so the runner must skip rather than "pass" them.
    check("production-data suites are skipped, not silently passed",
      /name: "activation", productionData: true/.test(runner) &&
      /name: "payments", productionData: true/.test(runner) &&
      /skipped — needs production data/.test(runner));
  }

  /* ---------------- 4. Fixtures cannot reach a real vendor -------------- */
  {
    // The harness seeds its own vendors and looks them up by a known slug. A
    // fixture that searched for "any seller" would, on the wrong database, find
    // a real one — and The Clovery published a live drop the same day this was
    // written.
    const seeds = ["tests/browser/seed/vendor.mjs", "tests/browser/seed/docs-vendor.mjs"];
    for (const file of seeds) {
      const src = readFileSync(file, "utf8");
      check(`${file} asserts the verification database`, /assertVerifyDatabase/.test(src));
      check(`${file} never selects an arbitrary existing seller`,
        !/seller\.findFirst\(\{\s*\}\)/.test(src) && !/findFirstOrThrow\(\)/.test(src));
    }
    const fixtureSrc = FIXTURE_ROUTES.map((r) => readFileSync(`app/api/dev/${r}/route.ts`, "utf8")).join("\n");
    check("no fixture route mutates a seller it did not create",
      !/seller\.update\(\{\s*where:\s*\{\s*\}/.test(fixtureSrc));
    check("no fixture route deletes by a broad pattern",
      !/deleteMany\(\{\s*where:\s*\{\s*\}\s*\}\)/.test(fixtureSrc));
    // Every lookup in a fixture route must be scoped — to an id it created, or
    // to a slug carrying its own random stamp. An unscoped findFirst is how a
    // fixture ends up operating on a real vendor: The Clovery published a live
    // drop the same day this was written, and "the first seller" would have
    // found it.
    const unscoped = [...fixtureSrc.matchAll(/prisma\.(seller|customer|drop|order|product)\.(findFirst|findMany)\(([^)]*)\)/g)]
      .filter((m) => !/where\s*:/.test(m[3]))
      .map((m) => `${m[1]}.${m[2]}`);
    check("no fixture route looks up a row without scoping it", unscoped.length === 0,
      unscoped.join(", "));
    check("fixture rows are stamped so they can never collide with real ones",
      FIXTURE_ROUTES.every((r) => /Date\.now\(\)/.test(readFileSync(`app/api/dev/${r}/route.ts`, "utf8"))));
  }

  /* ------------------------- 5. UTC / date safety ----------------------- */
  {
    check("a space-separated datetime is rejected", (() => {
      try { utc("2026-08-30 04:00:00"); return false; } catch { return true; }
    })());
    check("the ambiguous form is the one that caused the incident",
      !isUnambiguous("2026-08-30 04:00:00"));
    check("explicit UTC is accepted",
      utc("2026-08-30T04:00:00Z").toISOString() === "2026-08-30T04:00:00.000Z");
    check("a date-only string is treated as UTC midnight",
      utc("2026-08-30").toISOString() === "2026-08-30T00:00:00.000Z");
    check("a US-format date is rejected", (() => {
      try { utc("08/30/2026"); return false; } catch { return true; }
    })());
    check("a local-offset timestamp is rejected", (() => {
      try { utc("2026-08-30T04:00:00-07:00"); return false; } catch { return true; }
    })());
    check("a day range is end-exclusive", (() => {
      const { start, end } = utcDay("2026-08-30");
      return end.getTime() - start.getTime() === 86_400_000;
    })());
    check("a rolling window is measured from now backwards", (() => {
      const now = new Date("2026-08-30T12:00:00Z");
      const { start, end } = utcWindow(7, now);
      return end === now && start.toISOString() === "2026-08-23T12:00:00.000Z";
    })());
    check("a retention cutoff is a real instant",
      retentionCutoff(90, new Date("2026-08-30T00:00:00Z")).toISOString() === "2026-06-01T00:00:00.000Z");
    check("a zero or negative window is rejected", (() => {
      try { utcWindow(0); return false; } catch { return true; }
    })());

    // No new analytics/cleanup code may reintroduce the ambiguous form.
    const files = [
      "lib/analytics-events.ts", "lib/analytics-identity.ts", "lib/analytics-server.ts",
      "lib/reporting.ts", "lib/fixture-guard.ts", "lib/utc.ts",
    ];
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      // `new Date("… …")` with a space inside the literal is the ambiguous form.
      return /new Date\("[^"]*\s[^"]*"\)/.test(src);
    });
    check("no analytics or guard module parses an ambiguous date", offenders.length === 0,
      offenders.join(", "));
  }

  /* ------------------------- 6. Current process ------------------------- */
  {
    // Reported, not asserted: this says where THIS process is pointed, which is
    // the single most useful line when someone is wondering why a suite refused.
    const refusal = fixtureRefusal();
    results.push({
      name: "this process may create fixtures",
      pass: true,
      detail: refusal ? `no — ${refusal.reason}: ${refusal.detail}` : "yes — harness database",
    });
    check("fixturesAllowed agrees with fixtureRefusal",
      fixturesAllowed() === (refusal === null));
  }

  const passed = results.filter((r) => r.pass).length;
  const failures = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      suite: "isolation",
      fixturesAllowedHere: fixturesAllowed(),
      passed,
      failed: failures.length,
      results: failures.length ? failures : "all pass",
    },
    { status: failures.length === 0 ? 200 : 500 }
  );
}
