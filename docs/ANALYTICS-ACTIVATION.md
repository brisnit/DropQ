# Turning analytics on — the exact procedure

**Nothing here has been done.** `ANALYTICS_MODE` is unset in all three Vercel
environments and `AnalyticsEvent` has 0 rows. This is the runbook for when the
privacy policy is published and you decide to switch it on.

Order matters: **publish the policy first.** The promise and the behaviour must
never disagree, not even for an hour.

---

## 1. Setting the variable

```
vercel env add ANALYTICS_MODE production
# value: on
```

**Production scope only.** Not Preview, not Development.

- Preview is refused in code regardless (`VERCEL_ENV=preview` → no identity, no
  writes), but scoping the variable to Production means its *presence* matches
  its intent — nobody reading the env list later has to know about the guard to
  understand what is switched on.
- Development stays unset so `npm run dev` against a local database behaves like
  production-off by default.

Accepted values: `on`, `consent`, `off`. Anything unrecognised — including a
typo like `true` or `enabled` — is treated as **off**. There is no value that
turns analytics on by accident.

## 2. How Vercel applies an environment change — measured, not assumed

The first draft of this runbook got this wrong. It said the middleware reads
`ANALYTICS_MODE` at runtime and would start issuing cookies without a rebuild,
reasoning from the compiled bundle: `analyticsMode()` takes the environment as a
parameter, so the value is a dynamic `process.env` lookup that Next does not
inline. That much is true, and it is also irrelevant — **the process environment
itself is fixed when a deployment is created.**

### The experiment

A throwaway branch (`env-propagation-probe`, since deleted) added a route
echoing `analyticsMode()` from the Node runtime and middleware headers echoing it
from the Edge runtime, and deployed to Preview. `ANALYTICS_MODE=on` was then set
in Preview scope for that branch alone.

| | Node runtime | Edge middleware |
|---|---|---|
| Before the variable existed | `off`, raw `null` | `off`, raw `unset` |
| **Same deployment, 60s+ after setting it, no redeploy** | **`off`, raw `null`** | **`off`, raw `unset`** |
| New deployment via `vercel redeploy` | `on`, raw `on` | `on`, raw `on` |
| The original deployment, still running, same project env | **`off`** | **`off`** |

Three findings, all measured:

1. **A running deployment never sees a changed variable.** Not the Node runtime,
   not the Edge middleware, not after a minute, not with cache-busting.
2. **A redeploy is required, for both runtimes.** This is in addition to the
   static-prerender reason below, not instead of it.
3. **A deployment serves the environment snapshot it was built with.** The old
   preview kept reporting `off` while a sibling deployment of the same commit
   reported `on`. **This is what makes rollback a valid emergency-off** — with
   one caveat in §5.

A fourth thing fell out for free: with `ANALYTICS_MODE=on` genuinely set on a
Preview deployment, `writesAllowed` was **false** and **no cookies were issued**.
The preview guard was confirmed live, against a real preview build, with the
variable actually on.

### The second reason a redeploy is required

The root layout renders `<PageView enabled={analyticsMode() !== "off"} />`, and
`/`, `/discover`, `/privacy` and `/terms` are statically prerendered (`○` in the
build output). Their HTML has `enabled` baked in at build time. `/pricing`,
`/help` and `/signup` are dynamic (`ƒ`).

Both reasons point the same way, so the rule is simple and has no exceptions:

> **A change to `ANALYTICS_MODE` does nothing until you deploy.**

## 3. Turning it on — atomic from the operator's side

No half-on state is possible, because nothing at all changes until step 3.

```
# 1. confirm the privacy policy is already published, and the baseline
psql "$DATABASE_URL" -c 'SELECT count(*) FROM "AnalyticsEvent";'   # expect 0

# 2. configure — Production scope only
vercel env add ANALYTICS_MODE production --value on --yes

# 3. deploy — nothing above takes effect without this
#    Vercel dashboard → latest Production deployment → ⋯ → Redeploy
#    (no code change, no new commit)

# 4. verify
curl -sD- -o /dev/null https://www.drop-q.com/pricing | grep -i set-cookie
```

Between steps 2 and 3 the site behaves exactly as it does today. That is the
whole reason this ordering is safe.

## 4. What the first request should do

A person visiting `https://www.drop-q.com/pricing?utm_source=ig&utm_campaign=test`
with a fresh browser:

**Cookies set** (all `httpOnly`, `sameSite=lax`, `secure`):

| Cookie | Value | Max-Age |
|---|---|---|
| `dq_vid` | 32 hex characters | 31536000 (12 months) |
| `dq_sid` | 32 hex characters, different | 1800 (30 min) |
| `dq_attr` | JSON: `{first:{…},last:{…}}` | 7776000 (90 days) |

`dq_touch` is **not** set — that only happens on `/s/<slug>` routes, unchanged.

**One row in `AnalyticsEvent`:**

```
name           page_viewed
at             <now>
visitorId      <the dq_vid value>
sessionId      <the dq_sid value>
sellerId       null
customerId     null
dropId         null
path           /pricing          ← no query string
referrerDomain null              (or e.g. instagram.com)
utmSource      ig
utmMedium      null
utmCampaign    test
utmContent     null
utmTerm        null
device         mobile | desktop
env            production
isBot          false
isInternal     false
props          null
```

Four things to check specifically, each a bug if wrong: `path` contains no `?`,
there is no IP anywhere in the row, `env` says `production`, and `isBot` is false
for a real browser.

## 5. Emergency off — corrected

**Rollback works, and it is not enough on its own.**

It works because a deployment serves its own build-time snapshot (finding 3), so
a deployment created before the variable existed has `ANALYTICS_MODE` unset and
issues no cookies. Two conditions, both easy to get wrong under pressure:

- the rollback target must have been built **before** the variable was set —
  a deployment built after it inherits `on`;
- the project environment still says `on`, so **the next deploy from `main`
  silently re-enables analytics.** Rollback stops the bleeding; it does not
  change the decision.

**Use this order:**

```
# 1. STOP IT NOW (seconds, no build)
#    Vercel → Deployments → the last deployment built BEFORE analytics
#    was enabled → Instant Rollback
#    Verify: curl -sD- -o /dev/null https://www.drop-q.com/pricing | grep -i set-cookie
#            → nothing

# 2. MAKE IT STICK (minutes) — otherwise the next push turns it back on
vercel env rm ANALYTICS_MODE production --yes
#    then Redeploy from the dashboard

# 3. VERIFY
curl -sD- -o /dev/null https://www.drop-q.com/pricing | grep -i set-cookie   # nothing
psql "$DATABASE_URL" -c 'SELECT count(*), max(at) FROM "AnalyticsEvent";'    # count stops rising
```

If there is any doubt about which deployment is safe to roll back to, **skip
step 1 and go straight to step 2** — set or remove the variable so it evaluates
to `off`, then redeploy. It is a few minutes slower and has no ambiguity.

**What "off" does not do:** it does not delete anything already collected, and it
does not clear cookies already in people's browsers — those expire on their own
schedule (12 months / 30 minutes / 90 days). If collected data must go, that is a
`DELETE FROM "AnalyticsEvent"`, prepared the way the last cleanup was: an
explicit id allowlist and before/after verification.

## 5a. Proving Preview still writes nothing

Two independent checks:

1. **The variable is not there.** `vercel env ls` shows `ANALYTICS_MODE` scoped to
   Production only.
2. **Even if it were.** This has now been measured: with `ANALYTICS_MODE=on` set
   on a Preview deployment, `writesAllowed` was false and no cookies were issued.
   Confirm after activation with:
   ```sql
   SELECT count(*), env FROM "AnalyticsEvent" GROUP BY env;
   ```
   Every row must say `production`. A row saying `preview` means the guard failed
   and analytics should go off immediately.

## 6. First-live-data verification

Run this once, immediately after activation, before drawing any conclusion from
the numbers.

### The test subject

**Do not use a real vendor, a real customer, or The Clovery's live drop.**

Signup creates an ordinary Seller — there is no way to mark an account internal
during signup, and adding one would be a product change for a test. So the
classification is an explicit mutation immediately afterwards, and it is
verified rather than assumed.

| | |
|---|---|
| Store name | `Analytics Activation Check` |
| Email | `analytics-check@dropq.example` |
| Password | anything; it is never used again |

`dropq.example` is a reserved, unroutable domain, already used by the marketing
demo store. No mail can reach it and no person owns it.

**The mutation, run immediately after signup completes:**

```sql
-- 1. exactly one row, and it is the one we just made
SELECT id, "storeName", email, "internalKind", "createdAt"
FROM "Seller" WHERE email = 'analytics-check@dropq.example';

-- 2. classify it, by id from step 1
UPDATE "Seller" SET "internalKind" = 'staff' WHERE id = '<id from step 1>';

-- 3. prove it left every business audience
SELECT
  (SELECT count(*) FROM "Seller")                             AS all_sellers,
  (SELECT count(*) FROM "Seller" WHERE "internalKind" IS NULL) AS business_sellers;
```

`business_sellers` must be unchanged from before the test began, while
`all_sellers` is one higher. That is `sellerWhere("business")` from
`lib/reporting.ts` — the same predicate every business number uses — so proving
it here proves it everywhere.

`internalKind = 'staff'` is one of the six values in `INTERNAL_KINDS`. It removes
the vendor from business reporting while leaving it fully visible operationally,
which is correct: it is a real account that a real person could log into.

Its `AnalyticsEvent` rows still carry `isInternal = false`, because that flag is
stamped at write time and the vendor was not classified yet. That is expected and
is why step 6 below deletes the check's events rather than relying on the flag.

### The walk

Use one fresh browser profile, no extensions, and do not open the dashboard
first.

| Step | Do | Expect |
|---|---|---|
| 1 | Visit `https://www.drop-q.com/?utm_source=activation&utm_campaign=first-check` | `dq_vid`, `dq_sid`, `dq_attr` set. One `page_viewed`, `path=/`, `utmCampaign=first-check` |
| 2 | Click through to `/pricing` | Second `page_viewed`, **same** `visitorId` **and** `sessionId` |
| 3 | Open `/signup` | Third `page_viewed`, `path=/signup`, still the same ids |
| 4 | Type in the store-name field | *(Phase B wires `vendor_signup_started`; in Phase A expect nothing yet)* |
| 5 | Complete signup as the vendor above | `vendor_signed_up` with `sellerId` set; `Seller.firstTouchVisitorId` = the `dq_vid` from step 1 |
| 6 | Classify the vendor as `staff` | It disappears from business counts, stays in operational |

### The queries

```sql
-- one visitor, one session, three page views, in order
SELECT name, path, "visitorId", "sessionId", "utmCampaign", device, env, at
FROM "AnalyticsEvent" ORDER BY at;

-- the join that is the whole point of the feature
SELECT s."storeName", s."signupSource", s."signupCampaign", s."firstTouchAt",
       count(e.id) AS events_before_signup
FROM "Seller" s
LEFT JOIN "AnalyticsEvent" e ON e."visitorId" = s."firstTouchVisitorId"
WHERE s.email = 'analytics-check@dropq.example'
GROUP BY 1,2,3,4;
```

**Passes when:** exactly one distinct `visitorId`, one `sessionId`, three
`page_viewed` rows plus one `vendor_signed_up`, `signupCampaign = 'first-check'`,
`firstTouchAt` earlier than the seller's `createdAt`, `events_before_signup ≥ 3`,
every row `env = 'production'` and `isBot = false`, and **no row anywhere whose
`path` contains a `?`**.

**Fails, and analytics should go straight back off, if:** any row has
`env = 'preview'`, any `path` carries a query string, `firstTouchVisitorId` is
null after signup, or the three page views span more than one `visitorId`.

### Afterwards

Keep the check vendor. Classified `staff` it costs nothing, and it is a
known-good row to compare against later.

Delete its analytics events so the first real day's numbers are not a mix of your
walk-through and actual visitors:

```sql
DELETE FROM "AnalyticsEvent" WHERE "visitorId" = '<the dq_vid from step 1>';
SELECT count(*) FROM "AnalyticsEvent";   -- now genuinely only real traffic
```

Then leave analytics on and let it collect. Phase B (wiring the remaining
conversion events) and Phase C (the admin dashboard) are worth starting once
there are a couple of weeks of real events — a funnel drawn over three days
mostly measures the days.

## 7. Then, and only then

Phase B wires the remaining conversion events from their server transitions.
Phase C builds the admin dashboard. Neither is worth starting until real events
have been accumulating for a week or two — a funnel drawn over three days of
data mostly measures the days.
