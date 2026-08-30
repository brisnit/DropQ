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

## 2. A redeploy IS required — and the reason is not the obvious one

`analyticsMode()` takes the environment as a parameter (`env = process.env`) and
reads it as a dynamic property lookup, which Next explicitly does not inline. I
checked the built bundle: the edge middleware contains
`rn(e=process.env){let t=(e.ANALYTICS_MODE??""` — a runtime read, in the edge
chunk. **Middleware would start issuing cookies without a rebuild.**

The reason a redeploy is still required is the root layout:

```tsx
<PageView enabled={analyticsMode() !== "off"} />
```

That prop is evaluated when the page renders, and several public routes are
**statically prerendered** — `/`, `/discover`, `/privacy`, `/terms` are `○` in
the build output. Their HTML already contains `enabled={false}`, frozen at the
last build. `/pricing`, `/help` and `/signup` are dynamic (`ƒ`) and would pick
it up immediately.

So setting the variable alone produces a **half-on state**: identity cookies
issued everywhere, `page_viewed` events only from the dynamic pages. That is
worse than either extreme, because the funnel would silently under-count the
homepage — the top of the funnel.

**Therefore: set the variable, then redeploy.** In Vercel: the latest Production
deployment → ⋯ → **Redeploy**. No code change, no new commit.

## 3. What the first request should do

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

Things to look at specifically, because each is a bug if wrong: `path` has no
`?`, there is no IP anywhere, `env` says `production`, and `isBot` is false for
a real browser.

## 4. Proving Preview still writes nothing

Two independent checks:

1. **The variable is not there.** `vercel env ls` should show `ANALYTICS_MODE`
   scoped to Production only.
2. **Even if it were.** Open any preview deployment URL, browse two pages, then:
   ```sql
   SELECT count(*), env FROM "AnalyticsEvent" GROUP BY env;
   ```
   Every row must say `production`. A row with `env = 'preview'` means the guard
   failed and analytics should be turned off immediately.

The browser suite already proves this against a real `VERCEL_ENV=preview` app
sharing the production database; check 2 is the belt to that braces.

## 5. Turning it off again

**Fastest (seconds), no build:** Vercel → Deployments → the previous Production
deployment → **Instant Rollback**. The old build has `enabled={false}` baked in
and the middleware reads the variable at runtime, so identity stops immediately.

**Clean:** `vercel env rm ANALYTICS_MODE production`, then redeploy. Cookies stop
being issued at once (runtime read); the statically prerendered pages stop
beaconing after the rebuild.

**What off does NOT do:** it does not delete anything already collected, and it
does not clear cookies already in people's browsers. Those expire on their own
schedule. If you need collected data gone, that is a `DELETE FROM
"AnalyticsEvent"` — say so and I will prepare it the way the last cleanup was
prepared, with an explicit allowlist and before/after verification.

---

## 6. First-live-data verification

Run this once, immediately after activation, before drawing any conclusion from
the numbers.

### The test subject

**Do not use a real vendor, a real customer, or The Clovery's live drop.**

Create one controlled vendor through the real signup form, then classify it so
it can never contaminate business reporting:

- store name: **Analytics Activation Check**
- email: `analytics-check@dropq.example` — the `dropq.example` domain is
  reserved, unroutable, and already used by the marketing demo store
- immediately after signup: `UPDATE "Seller" SET "internalKind" = 'staff' WHERE
  email = 'analytics-check@dropq.example';`

`internalKind = 'staff'` removes it from every business audience via
`lib/reporting.ts` while leaving it visible operationally. It is a real vendor
row created through the real front door — which is the point, since the thing
being tested is the real signup path.

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

Keep the check vendor — classified `staff`, it costs nothing and gives you a
known-good row to compare against later. Delete its analytics events if you want
a clean first day:

```sql
DELETE FROM "AnalyticsEvent" WHERE "visitorId" = '<the dq_vid from step 1>';
```

## 7. Then, and only then

Phase B wires the remaining conversion events from their server transitions.
Phase C builds the admin dashboard. Neither is worth starting until real events
have been accumulating for a week or two — a funnel drawn over three days of
data mostly measures the days.
