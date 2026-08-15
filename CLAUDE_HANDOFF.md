# DropQ — Session Handoff

Written at the end of a long session so a fresh Claude Code session can pick up
without re-deriving context. Everything below was verified during the session
unless explicitly marked **unverified**.

**Repo:** `github.com/brisnit/DropQ` · app lives in `hotplate/`
**Canonical production domain:** `https://www.drop-q.com`
(`drop-q.com` 308-redirects to www. **`dropq.com` is NOT owned by DropQ** — it
resolves but serves someone else's page. Three stale references were fixed.)

---

## 1. Architecture

- **Next.js 16 App Router** · React 19 · TypeScript · Tailwind v4
- **Prisma → Postgres (Neon)**, deployed on **Vercel** from `origin/main`
- `hotplate/AGENTS.md` warns this Next version has breaking changes — **read
  `node_modules/next/dist/docs/` before using an unfamiliar API.** Two real
  bites this session: `cookies().set()` is Server-Function/Route-Handler only
  (silently no-ops in a page), and `NEXT_PUBLIC_*` is inlined at build time.
- **Prisma client is generated to `app/generated/prisma`** (not node_modules).
  Finder/iCloud sometimes leaves `* 2.ts` duplicates that break `tsc`. They
  appear in **both `.next` and `app/generated`** — clean both:

  ```
  find .next app/generated -name "* [0-9].*" -delete
  ```

  Scanning only `app/generated` is not enough: a real `tsc` failure came from
  `.next/types/routes.d 2.ts` and `.next/types/cache-life.d 2.ts` (duplicate
  `PageProps`/`LayoutProps` identifiers), with 19 stale files present in
  `.next` alone.

### Authentication — two hand-rolled HMAC cookie systems

| Principal | Cookie | Payload | Entry |
|---|---|---|---|
| Vendor (`Seller`) | `hp_session` | `sellerId.hmac` | password login |
| Customer (`Customer`) | `dq_customer` | `customerId.hmac` namespaced `customer:` | magic link only |

Both sign with `SESSION_SECRET`. The namespace prefix means a vendor token can
never validate as a customer token. **There is no OAuth and no password for
customers.** `lib/auth.ts` and `lib/customer-auth.ts`.

### Key models

`Seller` (vendor) · `Drop` · `Product` · `Order` · `OrderItem` · `Customer` ·
`CustomerVendor` · `Subscriber` · `Conversation`/`Message`/`Notification`/
`MessageDelivery` · DropMeet: `Region`/`Location`/`Market`/`MarketSchedule`/
`Event`/`VendorAppearance`/`DropMeetCandidate`/`ClaimRequest` · `SavedDrop`

---

## 2. Work completed in session 1

*(Session 2 is §5b, session 3 is §5c.)*

1. **Per-channel SMS consent on `Subscriber`** (TCPA) — unbundled, unchecked
2. **In-app messaging** — conversations, broadcast, notifications, polling
3. **DropMeet** — San Diego County discovery: map, search, filters, detail
   pages, vendor appearances, admin moderation, 16 seeded places
4. **Homepage DropMeet tout** + nav entry
5. **Phase 1** — vendor attribution + `CustomerVendor` relationships
6. **Phase 2** — My DropQ hub (`/my`, orders, saved, history)
7. **Phase 3** — guest→account conversion, vendor-first sign-in, return-to-intent
8. **A2P 10DLC compliance remediation** (see §4)
9. **Phase 4 (partial)** — `/my/account` profile + notification preferences

---

## 3. Database migrations — ALL APPLIED TO PRODUCTION

### ⚠️ The workflow changed in session 3 — migrations are now TRACKED

Everything up to and including Phase 6 was applied with `npx prisma db push`,
which leaves no history. As of session 3 the project uses **committed Prisma
migrations** in `prisma/migrations/`:

- `0_init` — the pre-Phase-7 production schema, generated *from the live
  database* (38 tables) and registered with `prisma migrate resolve --applied`.
  **It has never been executed and must never be run** — it exists only so
  Prisma has a baseline. It deliberately does not contain `PointsLedger`.
- `20260814162909_add_points_ledger` — the first real migration.

**Use `npx prisma migrate deploy` from now on, not `db push`.** Local `.env`
points `DATABASE_URL` at the *production* Neon branch, so either command writes
straight to prod — `db push` would also silently re-diverge the schema from the
migration history.

Verify at any time with `npx prisma migrate status` (expect "Database schema is
up to date") and a drift check:

```
npx prisma migrate diff --from-url "$DATABASE_URL_UNPOOLED" \
  --to-schema-datamodel prisma/schema.prisma --script
```

Expect `-- This is an empty migration.` Anything else is drift.

### Applied before session 3

Applied with `npx prisma db push` against `ep-rough-cake-atlwek15` (prod Neon).
All additive; no data was deleted.

| Migration | Notes |
|---|---|
| Messaging tables + `Order.customerId` | |
| `Subscriber.optInEmail/optInSms/smsConsentAt` | |
| DropMeet tables + `Region` | |
| `MarketSchedule.startTime/endTime` → nullable | day known, hours not |
| Customer attribution (`firstVendorId`, `signupSource`, …) | |
| `CustomerVendor` + per-channel consent columns | |
| `SavedDrop`, `Customer.stripeCustomerId` | needed `--accept-data-loss` for a unique index on a brand-new column — provably safe, all NULLs |
| `CustomerToken.followSellerId` | follow intent on magic link |
| **SMS consent columns on `Customer`** | see §4 |
| **`PointsLedger`** (session 3) | applied via `migrate deploy`, not `db push` |

### Backfills run (all idempotent)

```
npm run db:backfill-customers     → 12 orders → 7 customers
npm run db:backfill-attribution   → 6 attributed, 10 relationships, 2 cross-vendor
npm run db:backfill-points        → 8 orders, 112 points (dry run unless --commit)
npm run db:seed-region            → San Diego County, real US Census TIGER boundary
npm run db:seed-dropmeet          → 16 published, 4 candidates
```

---

## 4. Twilio / A2P — READ THIS FIRST

**Brand: APPROVED. Campaign: REJECTED** for (1) Terms & Conditions, (2) opt-in
information, (3) CTA could not be verified.

### Root causes found

- No publicly reachable SMS opt-in existed — no `/sms` page
- Checkout collected phone as **required** with implied consent, no checkbox
- `app/terms` had **no SMS section at all**
- Privacy said consent was granted *by providing a number* (consent-by-conduct)

### Consent architecture now

Single source of truth on **`Customer`**:

```
smsTransactionalConsent / …At / …Source
smsMarketingConsent     / …At / …Source
smsConsentDisclosureVersion
smsOptedOutAt / smsOptOutSource   ← global kill switch, carrier-authoritative
```

- `lib/sms-consent.ts` — versioned disclosure text (`2026-08-13.v1`),
  `SmsKind` → required consent mapping. **Client-safe.**
- `lib/sms-gate.ts` — `sendGatedSms()`, the one path every customer SMS must
  use. `recordSmsConsent()` writes the audit trail.
- `app/api/twilio/inbound/route.ts` — signature-verified STOP/HELP/START.
  Returns **empty TwiML by default** to avoid double-texting Twilio's Advanced
  Opt-Out; set `TWILIO_REPLY_INLINE=true` only if that's off.
- `app/sms/page.tsx` — public CTA page, renders the real disclosure constants
  so it can't drift from the forms.

### ⚠️ CURRENT LIVE STATE: all customer order texts are OFF

**0 customers hold SMS consent**, so every gated send skips. This is correct
A2P behaviour and what Twilio needs to see — but vendors will notice. Consent
rebuilds from the next checkout onward. **Do not backfill consent.**

### URLs to submit to Twilio

`https://www.drop-q.com/sms` · `/terms` · `/privacy`

### Still to do (agreed, not built) — items A, B, C

Vendor broadcasts still authorize against `Subscriber.optInSms`
(`lib/messaging.ts:329-345`), not `Customer.smsMarketingConsent`. It **fails
safe** (0 rows have it true, so nothing leaks) but it's a second consent store.

- **A.** `dispatchFor()`: read `Customer` instead. Split by type —
  `messageType: "announcement"` → **marketing**; a 1:1 vendor reply in an
  existing thread → **transactional**.
- **B.** `lib/actions/subscribe.ts`: also write `Customer.smsMarketingConsent`
  via `upsertCustomer` + `recordSmsConsent`, source `waitlist`.
- **C.** Keep `Subscriber` data for audit; stop it authorizing sends.
- **D.** ✅ done — marketing checkbox exists at `/my/account`.

**Explicit instruction from the user: do NOT auto-migrate existing
`Subscriber.optInSms = true` into `Customer.smsMarketingConsent`.** (Currently
0 rows anyway.) Do not delete `Subscriber` consent data.

### Manual steps only the user can do

1. Twilio Console → Messaging Service → Incoming Messages →
   `https://www.drop-q.com/api/twilio/inbound`
2. `vercel login && vercel link && npm run twilio:audit` — the read-only audit
   in `scripts/twilio-audit.mjs` reports account type, sender pool, brand and
   campaign status, and recent error codes. **Never run in this session** —
   CLI was unauthenticated.

---

## 5. Stripe / payments — as it exists today

**Connect DIRECT charges on the vendor's connected account:**

```
lib/actions/order.ts:95   drop.seller.stripeAccountId
lib/actions/order.ts:201  application_fee_amount: feeCents
lib/checkout.ts:144       { stripeAccount: order.seller.stripeAccountId }
```

The vendor is merchant of record and covers Stripe processing; DropQ takes
`application_fee_amount`. There is **no Stripe Customer** created at checkout.

### ⚠️ This blocks saved cards

A card saved on the **platform** account cannot be charged on a **connected**
account. So "save once, buy from any vendor" (the Buy Again goal) does not work
with the current model. Three options, all with tradeoffs:

1. Save per vendor — re-enter card per new vendor
2. Clone payment methods to each connected account
3. **Move to destination charges** (`on_behalf_of` + `transfer_data`) — the only
   one that truly delivers cross-vendor saved cards, but changes merchant of
   record, fee bearer, and dispute handling

### ✅ DECIDED — stay on direct charges (CONFIRMED)

Confirmed from Stripe's documentation that for destination charges, **with or
without `on_behalf_of`, disputes and dispute fees are debited from the platform
account**. DropQ will not take on that exposure at this stage.

- Production charge architecture **stays as-is**. Do not migrate.
- Phase 5 saved cards, if built, are **per-vendor** (Option 1).
- Universal cross-vendor saved cards are deferred to **Payments v2**, revisited
  only once DropQ has volume, vendor agreements, fraud controls,
  reserve/payout policy and cash reserves.
- If per-vendor saved cards can't be made to feel good, **defer the feature
  rather than change the financial liability model.**

Full evaluation: `docs/PAYMENTS-V2-ARCHITECTURE.md` (flow comparison, fee
impact, refund/dispute flows, negative-balance exposure, reserve strategy,
vendor-terms changes, migration plan).

`Customer.stripeCustomerId` exists but is unused — harmless, and reusable by v2.

### Bugs fixed this session

- `lib/checkout.ts` refunds now pass `refund_application_fee: true`. Previously
  DropQ kept its 2% on fully-refunded oversold orders while the vendor absorbed
  the loss.
- `charge.dispute.created` / `.closed` are now handled in the Stripe webhook,
  matched back to vendor and order, and emailed to `DROPQ_ADMIN_EMAILS` via
  `lib/disputes.ts`. Operational visibility only — under direct charges the
  money is the vendor's.

---

## 5b. Session 2 additions

- **Phase 6 — Auth.js Google sign-in for CUSTOMERS.** Deployed but **inert**:
  the button only renders when `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true"`,
  which is unset. Front-door pattern — Auth.js does the OAuth handshake,
  `lib/customer-oauth.ts` resolves the Customer, then we mint the existing
  `dq_customer` cookie. **Vendor auth untouched**; `auth.ts` has zero imports
  of `lib/auth.ts`. Verified: pre-existing vendor AND customer sessions both
  still return 200. `CustomerAccount` table applied to prod.
  57/57 self-test assertions pass (8 new OAuth ones, incl. "unverified email
  cannot claim an account").
- **Payments bugs fixed** — refunds now pass `refund_application_fee: true`
  (DropQ was keeping its 2% on fully-refunded orders); `charge.dispute.created`
  /`.closed` now handled and emailed to admins via `lib/disputes.ts`.
- **Logout fixes** — vendor sidebar nav lacked `min-h-0`/`overflow`, pushing
  "Log out" off-screen; mobile menu had no max-height; **admin had no logout at
  all**.
- **Phase 7 rewards — built.** *(Session 2 recorded this as "MIGRATION NOT RUN"
  and not deployed. It was in fact already pushed and deployed — see §5c.)*

---

## 5c. Session 3 — Phase 7 completed (`21a5e4b`)

**Phase 7 is done, migrated, deployed and verified.** See §6b for what's next.

### An outage this handoff caused — read before trusting §12 again

Session 2 recorded Phase 7 as "unpushed" and "NOT deployed". Both were wrong:
`ee3c719` was pushed to `origin/main`, so Vercel deployed it — **code that
queried `PointsLedger` was live for ~20h against a database where the table did
not exist.** `/my/rewards` 500'd for every signed-in customer, and "Rewards" is
an unconditional nav item in `components/my/nav.tsx`. Checkout was never at
risk: `awardPointsForOrder` was already wrapped in `.catch()`.

**Lesson: verify deployment state against the remote and the running site, not
against a previous handoff's prose.** `git rev-list --left-right --count
origin/main...HEAD` takes a second. A route that returns 307 rather than 404
when signed out is deployed.

### The three defects fixed while verifying

1. **`reversePointsForOrder` could suppress refund notifications.** It sits
   between issuing the Stripe refund and telling the buyer, and it threw. The
   exception escaped `finalizePaidOrder`, skipping the apology SMS **and**
   email; the webhook retry then found the order already `refunded`, returned
   early, and the message was never sent. **Buyers were silently refunded with
   no explanation.** It now never throws, with a `.catch()` at the call site as
   belt-and-braces.
2. **Points under-awarded in `absorb` mode.** `totalCents - feeCents` is only
   correct in `pass` mode — `totalCents` only includes the fee when the vendor
   passes it on (`lib/actions/order.ts:84`), and `feeMode` **defaults to
   `absorb`**. Now summed from `OrderItem.priceCents × quantity`, which also
   survives product edits/removal and a later `feeMode` change. Verified across
   all 8 paid production orders: one $5.00 absorb order earned 4 points instead
   of 5.
3. **`catch {}` hid real failures.** A bare catch treated *every* error as
   "already awarded" — which is exactly why a missing table was
   indistinguishable from a retry. Narrowed to `Prisma.PrismaClientKnownRequestError`
   with `code === "P2002"`; real errors now surface.

### How Phase 7 was verified

- `migrate status` clean; drift check returns an empty migration
- All four query shapes `/my/rewards` uses executed directly against prod
- The production build, run locally **against the production database**,
  rendered `/my/rewards` → **200** with the correct zero state
- Deployment confirmed via Vercel CLI: push 16:34:20 → deployment 16:34:21,
  ● Ready, aliased to `www.drop-q.com`
- Prod sweep: public routes 200, authenticated routes a consistent 307, no 500s

⚠️ **Production's `SESSION_SECRET` differs from local `.env`** (the same minted
cookie returns 200 locally and 307 in prod). That's correct security posture,
but it means you cannot authenticate to production from a local session — a
signed-in prod render has to be confirmed by a human in a browser.

⚠️ **Do not run `app/api/dev/messaging-selftest` while `.env` points at prod.**
It creates sellers, drops and orders and only cleans up on success; its own
docstring assumes a scratch database.

---

## 5d. Historical DropPoints backfill — DONE (2026-08-14)

`prisma/backfill-points.mjs` · `npm run db:backfill-points` · **dry run by
default, `--commit` to write.** Ran once against production: **8 rows, 112
points, 6 customers, 2 vendors.** Nothing further is pending.

| Vendor | Points |
|---|---|
| The Clovery | 68 |
| Paraiso Delicacies | 44 |

Christopher Henderson (25) and Britt N. Midgette (21) hold **cross-vendor**
balances — the first real exercise of that path, verified rendering correctly.

### The design decision worth not undoing

The rows use **`reason: "purchase"`, not a distinct backfill reason.** A
separate reason reads better but silently breaks two things, because the unique
index is `(orderId, reason)` — a different reason is a *separate* row, not a
conflicting one:

1. **Refunds would stop reversing.** `reversePointsForOrder()` looks up exactly
   `{ orderId, reason: "purchase" }`. A backfilled order refunded later would
   keep its points forever.
2. **Double-awarding becomes possible.** `awardPointsForOrder()` writes
   `reason: "purchase"`, which would NOT collide with a `purchase_backfill`
   row — so the order could be awarded twice.

Provenance lives in `note` instead: **`"Earned before DropPoints launched"`**.
It's queryable (`note IS NOT NULL`) and reads honestly to the customer, who
sees it in their history.

⚠️ **Apply the same reasoning to any future ledger writer** (pay-in-person
awards included): if a row represents a purchase award, its reason must be
`"purchase"` or refunds won't reverse it.

### Verified after the run

19/19 automated assertions: 8 rows · 112 points · per-customer and per-vendor
totals matching the dry run · every row `reason = "purchase"` · all 8 carrying
the historical note · both cross-vendor customers spanning 2 vendors each.
`Order`, `OrderItem`, `Customer` and `Seller` were verified untouched by
**content hash**, not just row count. A second dry run reports 8 skips and 0
proposed inserts. `/my/rewards` rendered against production data showing real
balances (Christopher 25 = 12 + 13; Britt 21 = 8 + 13).

### Known cosmetic wrinkle

Ledger `createdAt` is the **backfill** date, so a July order shows in history as
"Aug 14, 2026". The note is what explains this to the customer — which is a
second reason not to drop it. Not worth restating `createdAt` to the order date:
the ledger honestly records when the points were granted.

---

## 5e. In-person payments — architecture approved, Phase A SHIPPED (2026-08-14)

Full design: **`docs/IN-PERSON-PAYMENTS-ARCHITECTURE.md`**. Read it before
touching payments — it supersedes §6b below, which is now historical.

### The product model changed twice during design. The final one:

**Cash is completely outside DropQ.** There is no "mark paid externally", no
cash/Venmo/Zelle payment state, no external refund, no manual paid attestation.
An earlier draft designed all of that; it was withdrawn. Two payment paths only,
both Stripe:

| Path | Who starts it | Payment |
|---|---|---|
| Online order | customer | Stripe via DropQ |
| **Walk-up order** (Phases B–G, not built) | **vendor**, at the booth | Stripe via DropQ, on the customer's own phone |

**And the governing platform rule:**

> **A real DropQ vendor cannot sell unless Stripe is connected and currently
> charge-ready.** Not a payment option — "vendor without Stripe" is an
> incomplete-onboarding / selling-disabled state.

### Phase A — shipped, deployed, verified

Closed three ways to create a real order nobody paid for:

1. **`payInPerson=1`** — a form field the server never validated. Any customer
   could POST it against any drop and get a confirmed, inventory-consuming order
   with a "Got your order! 🎉" email. Removed entirely, client and server.
2. **Vendor without Stripe** — `useStripe` false fell into a branch commented
   `// Demo mode (no Stripe configured)`, meaning the *platform*. In production
   the key is always set, so it only ever fired for **vendors** who weren't
   charge-ready. Now gated; that branch is local-dev-only and labelled so.
3. **🔴 Charges revoked mid-drop** — `account.updated` writes
   `stripeChargesEnabled: false` whenever Stripe disables charges (unverified
   identity, expired document, risk review). A vendor with a **live drop and
   real customers** silently started taking free orders. This is the dangerous
   one: it isn't an onboarding case and can hit an established vendor mid-market.

Plus: drops can no longer be **published live** without Stripe (all three
`Drop.status` writers — `createDropAction`, `updateDropFullAction`,
`updateDropStatusAction`, the last of which also wrote the raw form value with
no whitelist).

**Deliberately still allowed, and there are tests pinning this:** drafts stay
fully editable, and `live → closed` / `live → draft` **always** work. A vendor
whose Stripe breaks mid-drop must be able to take their drop down.

### Where the rule lives

**`lib/payments.ts`** — `isVendorSellable()`, `sellerBlockReason()`,
`resolveDropStatus()`. **Do not re-inline this condition.** It was previously
hand-written in two files that were free to drift. It is `server-only` because
it reads `STRIPE_SECRET_KEY`, which is why `StripeRequiredBanner` is a server
component.

`sellerBlockReason()` distinguishes **`not_connected`** (never onboarded, low
urgency) from **`charges_disabled`** (connected, Stripe turned charges off —
urgent, possibly mid-drop). They previously shared one "finish setting up"
message that badly understated the second.

### Tests

`npm run test:phase-a` → **58 assertions, writes nothing.** Run it after any
change to payment eligibility or drop publishing.

⚠️ **`app/api/dev/messaging-selftest` was NOT run** — it creates sellers, drops
and orders, and `.env` points at production (§5c). Phase A doesn't touch
messaging and that route bypasses `placeOrderAction` entirely. Run it on the
next scratch database.

### Verified in production after deploy

Order count **9 → 9**. Drops 9, orderItems 18, pointsLedger 8, customers 8,
orderEvents 22 — all unchanged. Casa Makulay order byte-identical. Zero live
drops existed, so no customer or vendor was mid-sale. See §15.3 of the
architecture doc.

### 🔜 Approved follow-up, NOT implemented — do this before Phase B

> **When `account.updated` flips a vendor from charge-ready to not charge-ready,
> email them that selling is paused and action is required.**

`app/api/stripe/webhook/route.ts:126-132` already writes the flag and is the
natural trigger. Until this ships, a vendor whose Stripe breaks overnight finds
out only from the dashboard banner.

---

## 6b. ⚠️ SUPERSEDED — historical pay-in-person brief

**This section is out of date.** It proposed `Drop.allowPayInPerson`, a
"Mark as paid in person" vendor action and pay-in-person DropPoints. All three
were **rejected** during the design in §5e — cash is outside DropQ and
`Drop.allowPayInPerson` was never built. Kept only for provenance; follow
`docs/IN-PERSON-PAYMENTS-ARCHITECTURE.md` instead.

### Original text — approved brief

**Phase 7 is COMPLETE** (migrated, deployed, verified — see §5c). Phase 8 is
explicitly **blocked** until the pay-in-person work below is done and verified.
Do not stack unrelated roadmap work into this change.

### Phase 7 as shipped — the architecture to preserve

- `prisma/schema.prisma` — `PointsLedger`, append-only
- `lib/rewards.ts` — earn/reverse/balance, $1 = 1 point on **items only**
- `lib/checkout.ts` — awards after `finalizePaidOrder` commits; reverses on
  oversold refund
- `app/my/rewards/page.tsx` + nav entry — real balance, **no fake redemption**

Balance is derived from rows and never stored. Idempotency is the unique
`(orderId, reason)`. Refunds append negative rows rather than decrementing.
Both DropQ-wide and seller scope are recorded on every row. **No redemption** —
that's a pricing decision, not an unfinished feature.

`PointsLedger.orderId` has **no foreign key on purpose.** The ledger is an
append-only audit record and keeps the historical order id even if the `Order`
row is later deleted. Don't "fix" this by adding a relation.

### Approved, still to build — pay in person

1. **`Drop.allowPayInPerson Boolean @default(false)`** + opt-in checkbox in the
   drop editor, labelled **"Allow customers to pay at pickup"** with copy
   *"Customers can reserve their order now and pay you in person at pickup."*
   **Do not default on.** Live-drop behaviour must not change.
   Intended condition `(live || allowPayInPerson) && paymentsEnabled` —
   **VERIFY this against the real checkout architecture before changing it.**
   Note `paymentsEnabled` is false when the vendor has no Stripe, in which case
   *all* orders are already implicitly pay-in-person.
2. **Pay-in-person orders earn points only on explicit payment confirmation.**
   Do NOT award when an unpaid order is marked completed — fulfilment and
   payment are separate events. Add a **"Mark as paid in person"** vendor
   action that: verifies the order was pay-in-person, sets paid + a `paidAt`
   timestamp, **preserves the method as cash/payInPerson rather than pretending
   Stripe processed it**, and triggers the same idempotent award path. Never
   award twice on retry. Reuse existing schema if it already models this
   cleanly — `Order.paymentStatus` and `OrderEvent` probably do.
   **Write the ledger row with `reason: "purchase"`** — see §5d for why a
   distinct reason would break refund reversal and permit double-awarding.
3. **ANSWER BEFORE IMPLEMENTING** — inspect and report what currently happens
   when: (a) a pay-in-person preorder is cancelled before payment; (b) the
   vendor marks it paid then refunds/voids; (c) the order is fulfilled but
   payment was never recorded. **Points must follow recorded payment, not
   fulfilment.** Still unanswered as of session 3.
4. **Customer UX** — at checkout, make it unmistakable that no online charge is
   being made and payment is due to the vendor at pickup.
5. **Auditability** — cash isn't Stripe-verified, so record who marked it paid
   and when. `OrderEvent` already exists and is the cheap place for this.

### Required before any production migration

Show the user: schema changes · migration SQL · affected payment/order code
paths · how points are triggered for Stripe vs pay-in-person · how duplicate
awards are prevented. Wait for explicit approval.

Then the safe order: **migrate → verify prod schema → deploy code.** Generate
the SQL with `prisma migrate diff` against the live database rather than
trusting SQL pasted in a previous session, commit the migration, and apply it
with `migrate deploy` (see §3).

⚠️ **Phase 7's outage came from deploying code ahead of its migration.** With
Vercel auto-deploying `origin/main`, pushing schema-dependent code before the
migration lands *is* shipping a broken production site. Migrate first, or don't
push.

---

## 6. Outstanding roadmap

See `docs/CUSTOMER-PLATFORM-ROADMAP.md` for the full ordered plan.

- **Phases 1–3: ✅ shipped.** Phase 4: partial (4.1, 4.3, part of 4.4).
- **4.2 addresses** — not started, needs a `CustomerAddress` model + checkout wiring
- **4.4 data export/deletion** — currently a support email, deliberately not a fake button
- **Phase 5** — 5.1 blocked on the Stripe decision above; **5.3 verified reviews
  is the cleanest next win** (`Review.authorName` is a free string; add nullable
  `customerId` + `orderId` and a purchase check); 5.4 support requests needs a
  new model
- **Phase 6 Auth.js** — Google + Apple + magic link. ⚠️ the HMAC cookie serves
  **vendors too**; migration must not log vendors out
- **Phase 7 rewards — ✅ SHIPPED** (`21a5e4b`) **and backfilled** (§5d).
  Earning only, no redemption. Nothing outstanding.
- **Phase 8 PostHog** — `lib/analytics.ts` is already the abstraction seam;
  `/api/track` currently only `console.log`s. **Blocked** until pay-in-person
  is complete and verified. Decisions already recorded in the roadmap: use
  `lib/analytics.ts`, `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`,
  identify by `Customer.id` only, no PII, app DB stays the source of truth for
  business metrics, and inspect `Customer.firstVendorId` / `signupSource` /
  `CustomerVendor` before building duplicate analytics infrastructure.

---

## 7. Decisions made

1. **Auth → Auth.js** (Google, Apple, magic link), DropQ-branded, vendor context preserved
2. **Saved cards → Stripe Customers**, not a launch blocker *(see §5 — the
   Connect model may force a rethink)*
3. **Rewards → $1 = 1 DropPoint**, no dollar value yet, two scopes designed for
4. **Analytics → PostHog** behind a thin abstraction
5. **Purchase ≠ Follow ≠ Marketing consent** — enforced in schema
6. **Canonical domain = `https://www.drop-q.com`**
7. **No auto-migration of historical SMS opt-ins**

## 8. Decisions still pending

- **Stripe direct vs destination charges** (blocks 5.1/5.2) — the big one
- What a DropPoint redeems for
- ~~Whether to backfill DropPoints for historical orders~~ — **RESOLVED
  2026-08-14: backfilled.** All 8 paid orders, 112 points, 6 customers, 2
  vendors. See §5d.
- Whether to keep the dev self-test route long term
- Whether vendors need warning that checkout phone is now optional

---

## 9. Known bugs & gaps

- **🔴 DropMeet map renders blank.** Root cause never identified. Verified good:
  token in bundle, mapbox CSS shipped, container rendered, fixes deployed. Two
  real bugs were fixed (async 401s weren't surfaced; no resize handling) and a
  12s watchdog now self-diagnoses. **Needs browser console output to progress.**
- **14 seeded markets have a day but no opening hours**, and there is no
  schedule editor UI to add them
- **4 DropMeet candidates quarantined** with no admin review panel
- `vendorUpcomingAppearances()` exists but isn't wired into `/s/[slug]`
- Saving individual **products** is still localStorage-only (`lib/saved-store.ts`)
- **Checkout phone is now optional** — vendors lose SMS reach for those orders
- ~~Pay-in-person orders earn 0 DropPoints~~ — **obsolete.** Customer-facing
  pay-in-person was removed in Phase A (§5e); every DropQ order is paid by card
  through Stripe, so there is no unpaid-order points case to fix.
- ~~All 8 existing paid orders hold 0 DropPoints~~ — **fixed 2026-08-14**, all
  8 backfilled for 112 points (§5d).
- Stale `* 2.ts` duplicates in `.next`/`app/generated` break `tsc`
  intermittently — clear with `find .next app/generated -name "* [0-9].*"
  -delete` (both directories; see §1)

---

## 10. Environment variables

**Never print values.** Prod values live in Vercel; pull with
`vercel env pull .env.vercel.local` (gitignored — delete after use).

| Var | Purpose | State |
|---|---|---|
| `DATABASE_URL` / `_UNPOOLED` | Neon pooled / direct | set |
| `SESSION_SECRET` | signs BOTH session cookies | set |
| `RESEND_API_KEY`, `EMAIL_FROM` | email | set in Vercel |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | payments | set |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_MESSAGING_SERVICE_SID` | SMS | set in Vercel, **not local** |
| `MESSAGING_SMS_ENABLED` | gates messaging-notification SMS | **unset** (off) |
| `TWILIO_REPLY_INLINE` | inline STOP/HELP replies | unset — only if Advanced Opt-Out is off |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | DropMeet map | set in Vercel; **map still blank** |
| `BLOB_READ_WRITE_TOKEN`, `APP_URL`, `CRON_SECRET`, `DROPQ_ADMIN_EMAILS` | | set |

---

## 11. Files the next session should inspect

**SMS/consent (touch carefully):** `lib/sms-consent.ts`, `lib/sms-gate.ts`,
`app/api/twilio/inbound/route.ts`, `app/sms/page.tsx`, `scripts/twilio-audit.mjs`

**Identity/attribution:** `lib/customer-auth.ts`, `lib/attribution.ts`,
`middleware.ts` (first-touch cookie — **must** stay in middleware)

**Messaging:** `lib/messaging.ts` (⚠️ line ~329 old consent read),
`lib/message-delivery.ts`, `lib/actions/messages.ts`

**Customer hub:** `app/my/*`, `lib/my-dropq.ts`, `components/my/*`

**Commerce:** `lib/actions/order.ts`, `lib/checkout.ts`, `lib/stripe.ts`

**Rewards:** `lib/rewards.ts`, `app/my/rewards/page.tsx`,
`prisma/migrations/`. Note `lib/actions/order.ts:84` — `totalCents` includes the
DropQ fee **only** in `pass` mode, and `feeMode` defaults to `absorb`. Any money
maths derived from `totalCents` has to account for that; getting it wrong is
what under-awarded points in Phase 7.

**DropMeet:** `lib/dropmeet/*`, `app/dropmeet/*`, `components/dropmeet/map.tsx`

**Tests:** `app/api/dev/messaging-selftest/route.ts` — **49 assertions, 404s in
production.** Run it after any messaging/consent change:
`curl localhost:3000/api/dev/messaging-selftest`

**Docs:** `docs/CUSTOMER-PLATFORM-ROADMAP.md`

---

## 12. Git status

Working tree clean, all pushed to `origin/main`, **and code and database are in
step.** Verified with `git rev-list --left-right --count origin/main...HEAD`
(→ `0  0`) and `npx prisma migrate status`, not from memory — session 2's
version of this section was wrong in exactly that way and caused an outage
(§5c). Recent commits, newest first:

```
21a5e4b  Phase 7: migrate PointsLedger, tracked migrations, 3 rewards fixes
ee3c719  Phase 7 rewards foundation  ← msg says "MIGRATION NOT RUN"; now run
e293d30  Fix logout unreachable for vendors and admins
e4f0ece  Document customer OAuth env vars; flag stays unset
f4e32df  Phase 6: Auth.js Google sign-in for customers (front door)
7ee7591  Payments: keep direct charges; fix refund fee, add dispute visibility
1ce3983  Document DropQ Payments v2 architecture (design only)
845edff  Add session handoff document
6a211b7  Phase 4 (partial): account profile and notification preferences
48ed15d  A2P 10DLC compliance remediation  ← msg says "NOT DEPLOYED"; it IS deployed
3bc6120  Phase 3: guest to account conversion
2cbf47e  Phase 1: vendor attribution and customer-vendor relationships
```

Everything through `21a5e4b` is migrated **and** deployed. Deployment confirmed
via Vercel CLI (push 16:34:20 → deployment 16:34:21, ● Ready, aliased to
`www.drop-q.com`) — the CLI is authenticated as `brisnit-1848`, so
`npx vercel ls drop-q --scope britt-midgettes-projects` is the fast way to
check what is actually live. The handoff's §10 note that the CLI was
unauthenticated is out of date.

New env vars since v1: `AUTH_SECRET`, `AUTH_TRUST_HOST`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` (all unset in prod —
Google sign-in ships inert until set).

---

## 13. Working agreements

- Verify before claiming — render pages, measure in a browser, run the self-test
- Never invent data (addresses, hours, consent). Unverifiable → candidate queue
- `--accept-data-loss` only after proving no data can be lost, and say why
- Migrate **before** pushing code that reads new columns. **This agreement was
  broken in session 2 and took down `/my/rewards` for ~20h** (§5c) — `main`
  auto-deploys, so an unmigrated push is a live outage, not a staging problem
- Don't push without being asked
- **Trust the repo over the handoff.** Check `origin/main` vs `HEAD` and
  `prisma migrate status` before believing any claim about what is deployed or
  migrated — including claims in this document
