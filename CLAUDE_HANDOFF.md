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
  Finder/iCloud sometimes leaves `* 2.ts` duplicates there that break `tsc` —
  delete with `find app/generated -name "* [0-9].*" -delete`.

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

## 2. Work completed this session

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

### Backfills run (all idempotent)

```
npm run db:backfill-customers     → 12 orders → 7 customers
npm run db:backfill-attribution   → 6 attributed, 10 relationships, 2 cross-vendor
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
- **Phase 7 rewards — BUILT, MIGRATION NOT RUN.** See §6b.

---

## 6b. ⚠️ NEXT SESSION STARTS HERE — approved brief

Phase 7 code is written and compiles; **`PointsLedger` has NOT been migrated**.
Do not stack unrelated roadmap work into this change.

### Already built (uncommitted or committed but unmigrated)

- `prisma/schema.prisma` — `PointsLedger` model
- `lib/rewards.ts` — earn/reverse/balance, $1 = 1 point, excludes service fee
- `lib/checkout.ts` — awards after `finalizePaidOrder` commits; reverses on
  oversold refund
- `app/my/rewards/page.tsx` + nav entry — real balance, **no fake redemption**

### Approved, still to build

1. **Run the `PointsLedger` migration**, then complete Phase 7. Keep the
   approved architecture: balance derived from rows, idempotent
   `(orderId, reason)`, refunds as negative rows, both DropQ-wide and seller
   scope recorded, earn excludes DropQ service fees, **no redemption**.
2. **`Drop.allowPayInPerson Boolean @default(false)`** + opt-in checkbox in the
   drop editor, labelled **"Allow customers to pay at pickup"** with copy
   *"Customers can reserve their order now and pay you in person at pickup."*
   **Do not default on.** Live-drop behaviour must not change.
   Intended condition `(live || allowPayInPerson) && paymentsEnabled` —
   **VERIFY this against the real checkout architecture before changing it.**
   Note `paymentsEnabled` is false when the vendor has no Stripe, in which case
   *all* orders are already implicitly pay-in-person.
3. **Pay-in-person orders earn points only on explicit payment confirmation.**
   Do NOT award when an unpaid order is marked completed — fulfilment and
   payment are separate events. Add a **"Mark as paid in person"** vendor
   action that: verifies the order was pay-in-person, sets paid + a `paidAt`
   timestamp, **preserves the method as cash/payInPerson rather than pretending
   Stripe processed it**, and triggers the same idempotent award path. Never
   award twice on retry. Reuse existing schema if it already models this
   cleanly — `Order.paymentStatus` and `OrderEvent` probably do.
4. **ANSWER BEFORE IMPLEMENTING** — inspect and report what currently happens
   when: (a) a pay-in-person preorder is cancelled before payment; (b) the
   vendor marks it paid then refunds/voids; (c) the order is fulfilled but
   payment was never recorded. **Points must follow recorded payment, not
   fulfilment.**
5. **Customer UX** — at checkout, make it unmistakable that no online charge is
   being made and payment is due to the vendor at pickup.
6. **Auditability** — cash isn't Stripe-verified, so record who marked it paid
   and when. `OrderEvent` already exists and is the cheap place for this.

### Required before any production migration

Show the user: schema changes · migration SQL · affected payment/order code
paths · how points are triggered for Stripe vs pay-in-person · how duplicate
awards are prevented.

Then the safe order: **migrate → verify prod schema → deploy code.**

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
- **Phase 7 rewards** — $1 = 1 DropPoint agreed, nothing built
- **Phase 8 PostHog** — `lib/analytics.ts` is already the abstraction seam;
  `/api/track` currently only `console.log`s

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
- **Pay-in-person orders currently earn 0 DropPoints** — points award on
  `paymentStatus === "paid"`, which only Stripe sets. Item 3 above fixes this.
- **Existing paid orders earned no points** (ledger is new). A backfill is
  possible but was NOT run — the user has not decided whether history counts.
- Stale `* 2.ts` duplicates in `.next`/`app/generated` break `tsc` intermittently

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

**DropMeet:** `lib/dropmeet/*`, `app/dropmeet/*`, `components/dropmeet/map.tsx`

**Tests:** `app/api/dev/messaging-selftest/route.ts` — **49 assertions, 404s in
production.** Run it after any messaging/consent change:
`curl localhost:3000/api/dev/messaging-selftest`

**Docs:** `docs/CUSTOMER-PLATFORM-ROADMAP.md`

---

## 12. Git status

Working tree clean, all pushed to `origin/main`. Recent commits, newest first:

```
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

**⚠️ Code and database are NOT in step.** Phase 7 (`PointsLedger`) is written
locally but unmigrated and unpushed. Everything through `e293d30` is deployed
and migrated.

New env vars since v1: `AUTH_SECRET`, `AUTH_TRUST_HOST`, `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED` (all unset in prod —
Google sign-in ships inert until set).

---

## 13. Working agreements

- Verify before claiming — render pages, measure in a browser, run the self-test
- Never invent data (addresses, hours, consent). Unverifiable → candidate queue
- `--accept-data-loss` only after proving no data can be lost, and say why
- Migrate **before** pushing code that reads new columns
- Don't push without being asked
