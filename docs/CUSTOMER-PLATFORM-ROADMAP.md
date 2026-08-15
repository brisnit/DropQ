# DropQ Customer Platform — Build Order

The plan for turning DropQ into one connected customer ecosystem:
**DropQ = Buy · DropMeet = Discover · My DropQ = the customer's hub.**

Work top to bottom. Each phase is shippable on its own and doesn't strand the
one before it. Items marked **[YOU]** need a decision or an external account
from you before the code can be finished.

Status legend: `[ ]` not started · `[~]` partially exists · `[x]` done

---

## Already built (from previous sessions — don't rebuild)

- [x] Global `Customer` identity, keyed on email, shared by DropQ + DropMeet
- [x] Passwordless magic-link sign-in (`dq_customer` cookie, 60-day)
- [x] Guest checkout, with `upsertCustomer` running at checkout
- [x] `Order.customerId` linking orders to the durable identity (backfilled)
- [x] In-app messaging, notifications, per-channel delivery (email/SMS/push)
- [x] DropMeet discovery: map, search, filters, detail pages, follows for
      locations and markets
- [x] Per-channel marketing consent on `Subscriber` (TCPA-safe)
- [x] Analytics beacon + typed event vocabulary (`/api/track`)

---

## PHASE 1 — Foundation: attribution and relationships ✅ SHIPPED

Live on production. Backfill reconstructed 6 attributed customers, 10
relationships, 2 cross-vendor buyers. `followedAt` left null everywhere —
nobody had been offered a follow, so recording one would have invented consent.

- [x] 1.1 `Customer` acquisition fields: `firstVendorId`, `firstDropId`,
      `signupSource`, `firstTouchAt`, `firstPurchaseAt`
- [x] 1.2 `CustomerVendor` model — the customer↔vendor relationship:
      `followedAt`, `firstPurchaseAt`, `lastPurchaseAt`, `orderCount`,
      `relationshipSource`
- [x] 1.3 Capture first-touch on entry to a vendor storefront / drop link.
      NOTE: the helper shipped in Phase 1 never actually fired — cookies().set()
      is Server-Function/Route-Handler only, so calling it from a page silently
      no-ops. Fixed in Phase 3 by moving the write to middleware.ts, which
      stores the vendor *slug* (edge runtime has no Prisma) for later resolution
- [x] 1.4 Record the relationship on purchase and on follow
- [x] 1.5 Backfill both from existing orders
- [x] 1.6 Follow/unfollow a vendor (server action + button on storefront)

## PHASE 2 — My DropQ hub ✅ SHIPPED

- [x] 2.1 `/my` route + customer shell nav (Home · Orders · Saved · DropMeet ·
      Account) reusing the existing `/messages` chrome
- [x] 2.2 Home: greeting, active orders, followed vendors, upcoming drops from
      those vendors, nearby DropMeet activity
- [x] 2.3 `/my/orders` — active vs past, order detail, receipt, reorder
- [x] 2.4 `/my/saved` — saved drops, followed vendors, markets and places.
      `SavedDrop` is server-side and cross-device. Saving individual
      *products* is still open (lib/saved-store.ts is localStorage only)
- [x] 2.5 Move `/messages` under the same shell so it stops being a separate
      island
- [x] 2.6 My Drop History — the visual, collection-style view of drops joined

## PHASE 3 — Guest → account conversion ✅ SHIPPED

- [x] 3.1 Post-checkout prompt on the order page: "Save your order and follow
      *{Vendor}*", prefilled from checkout data
- [x] 3.2 One-tap conversion: claim guest orders by verified email, preserve
      vendor + drop attribution and consent
- [x] 3.3 Vendor-first signup screen when entering via a vendor/drop link
      (vendor logo, drop art, pickup info stay prominent)
- [x] 3.4 Return-to-intent after auth — back to the drop, follow, or checkout
      they started, never a generic dashboard

## PHASE 4 — Account settings

- [ ] 4.1 `/my/account` — profile (progressive, nothing required at signup)
- [ ] 4.2 Addresses + pickup/delivery preferences, reused at checkout
- [ ] 4.3 Notification preferences, granular per type, wired to the existing
      delivery-channel layer
- [ ] 4.4 Privacy, data controls, sign out, delete account (visually separated)

## PHASE 5 — Commerce depth

- [x] 5.1 **DECIDED — stay on direct charges.** Confirmed from Stripe's docs
      that for destination charges, *with or without* `on_behalf_of`, disputes
      and dispute fees are debited from the **platform** account. DropQ will not
      assume that exposure at this stage. See
      `docs/PAYMENTS-V2-ARCHITECTURE.md`.
- [ ] 5.2 `/my/payments` — **per-vendor** saved cards only (a card saved on a
      connected account cannot be used at another vendor). Universal
      cross-vendor saved cards are deferred to Payments v2. Never store card
      data. If per-vendor can't be made to feel good, defer rather than change
      the charge architecture.
- [ ] 5.3 Verified-purchase reviews: extend `Review` with `customerId` +
      `orderId` (currently `authorName` is a free string, so reviews can't be
      verified today)
- [ ] 5.4 Support requests tied to an order, auto-associating customer, vendor,
      order, products, drop

## PHASE 6 — Auth expansion **[YOU — decision needed]**

Current auth is a hand-rolled HMAC cookie for both vendors and customers.
Adding Google/Apple means one of:

- **Option A** — adopt Auth.js (NextAuth). Cleanest long-term, but it's a real
  migration that touches vendor auth too. ~1 session.
- **Option B** — hand-roll Google + Apple OAuth alongside the existing cookie.
  Less disruption, more code to own.
- **Option C** — keep magic-link only for now.

- [ ] 6.1 Pick an option
- [ ] 6.2 **[YOU]** Register the OAuth apps (Google Cloud Console, Apple
      Developer — Apple requires a paid account and a Services ID)
- [ ] 6.3 Implement, preserving one identity per email so no duplicate
      customers are created

## PHASE 7 — Rewards ✅ SHIPPED (`21a5e4b`)

Live, migrated and verified. **Earning only — there is no redemption**, and the
page says so plainly rather than implying one is coming imminently.

- [x] 7.1 Model decided: **$1 spent = 1 DropPoint**, recorded with both scopes
      (DropQ-wide *and* seller) on every row, so either redemption model can be
      built later with no backfill
- [x] 7.2 Schema + earn rules — `PointsLedger`, append-only. Balance is derived
      by summing rows, never stored. Idempotent on unique `(orderId, reason)`.
      Refunds append a negative row instead of decrementing. `orderId` carries
      **no foreign key on purpose**: the ledger is an audit record and keeps the
      historical order id even if the `Order` is deleted
- [x] 7.3 `/my/rewards` — real balance, per-vendor breakdown, history, and an
      honest "points aren't redeemable yet" note. No fake balances
- [ ] 7.4 **Redemption** — deferred. Assigning a DropPoint a dollar value is a
      pricing decision (see decision 3), not an engineering task
- [x] 7.5 **Backfill for historical orders — DONE** (2026-08-14). All 8 paid
      orders awarded at the corrected rate: **112 points, 6 customers, 2
      vendors** (The Clovery 68, Paraiso Delicacies 44). Run once via
      `npm run db:backfill-points -- --commit`; the script is dry-run by
      default and idempotent, so it is safe to re-run and will report 8 skips.
      The fulfilled-but-unpaid Casa Makulay order was correctly excluded —
      points follow recorded payment, never fulfilment

### Bugs found and fixed while verifying (worth not reintroducing)

1. Points were derived from `totalCents - feeCents`. That is only correct in
   `pass` mode — `totalCents` includes the DropQ fee **only** when the vendor
   passes it on, and `Seller.feeMode` **defaults to `absorb`**. Now summed from
   `OrderItem.priceCents × quantity`, which is also immune to a product being
   edited or removed and to `feeMode` changing after the sale
2. `reversePointsForOrder` threw, which suppressed the refund SMS *and* email on
   oversold orders — buyers were silently refunded with no explanation. It now
   never throws
3. A bare `catch {}` treated every error as "already awarded". Narrowed to
   Prisma `P2002`

## PHASE V — Vendor Onboarding / Activation  **[NEW — not started]**

> **Recommended position: immediately after in-person Phase B, before Phase C.**
> Not because it is urgent in the abstract — because **5 of 9 production vendors
> are not Stripe charge-ready** and therefore cannot sell at all. Walk-up sales
> need a charge-ready account exactly as online sales do, so shipping the
> in-person feature first delivers it to 44% of the vendor base. Onboarding is
> what makes that work worth building.
>
> It is cleanly separable — this phase touches the vendor dashboard and `Seller`
> state; in-person Phases C–G touch checkout and `WalkUpSale` — so the two can
> run in parallel given capacity.

### Product principle

**Stripe is mandatory for every DropQ vendor who wants to sell.** Connecting it
should feel like a normal, required step in becoming **Ready to Sell** — not an
error a vendor discovers when they try to publish.

Phase A made the rule real (a non-charge-ready vendor cannot publish or sell).
This phase makes the rule *kind*: it should be obvious from signup onward what
remains before selling can start.

A vendor without Stripe must still be able to:

- create and edit their business/store profile
- add products
- create and edit **draft** drops
- explore the whole dashboard

They cannot publish or sell until Stripe is charge-ready. That boundary is
already enforced and tested — see `docs/IN-PERSON-PAYMENTS-ARCHITECTURE.md` §14.

### The activation journey

A **Get Ready to Sell** checklist, conceptually:

```
✓ Create account
✓ Complete business/store information
○ Connect Stripe
○ Add first product
○ Create first drop
○ Publish first drop
```

**Do not treat those as the final steps.** Derive the real activation milestones
from the product when the phase begins — `Seller` already carries
`emailVerified`, `termsAcceptedAt`, `stripeAccountId`, `stripeChargesEnabled`,
`dropsCreated`, plus profile fields, and `VendorProduct` / `Drop` / `Order`
answer the rest.

Full spec: **`docs/VENDOR-ACTIVATION.md`**.

- [x] **V.0 — derived activation model.** `lib/activation.ts` + a 63-assertion
      dev selftest. Pure derivation, no schema, nothing renders it yet. Every
      later sub-phase and the admin view consume this one module rather than
      re-deriving activation rules.
- [ ] **V.1 — `Seller.stripeChargesEnabledAt`.** One nullable column, written
      exactly once on the first charge-ready transition, never overwritten.
      Distinguishes *restricted* from *never finished*. **Designed, awaiting
      approval; no backfill — see VENDOR-ACTIVATION.md §11.3.**
- [ ] **V.2 — Dashboard "Get ready to sell" card.** Replaces the existing
      "Next step" card while activation is incomplete (that card currently tells
      Stripe-less vendors their drop is ready to publish, which is false).
      Collapses when done, disappears after the first paid order.
- [ ] **V.3 — Contextual nudges** after saving a product/draft drop, and
      disabling the "live" option in the drop editor for non-charge-ready
      vendors. **Presentation only — the Phase A server gate stays authoritative.**
- [ ] **V.Admin — Vendor Activation Operations.** Admin visibility into who
      can't sell and who is worth contacting. Recommended **after V.2**; it is
      the highest-immediate-value sub-phase, because 5 of 9 vendors cannot sell
      and nobody can currently see that without a database query. Manual
      outreach only — no automated campaigns.
- [ ] **V.4 — activation analytics.** Deferred to Phase 8.5.

### Stripe status granularity

Today `Seller` has `stripeAccountId` + `stripeChargesEnabled`, from which
`lib/payments.ts` already derives `not_connected` / `charges_disabled` /
`suspended`. The states worth distinguishing:

| State | Derivable today? |
|---|---|
| not started | ✅ `stripeAccountId IS NULL` |
| setup started / incomplete | ⚠️ needs `account.details_submitted` (fetched on `/dashboard/payments`, not stored) |
| connected but not charge-ready | ✅ `sellerBlockReason() === "charges_disabled"` |
| charge-ready | ✅ `isVendorSellable()` |
| previously charge-ready, now restricted | ⚠️ needs history — the `account.updated` webhook is the natural place to record it |

**Derive readiness from authoritative state; do not add a hand-maintained
`readyToSell` flag** unless inspection proves one is necessary. A cached flag
would go stale the moment Stripe revokes charges — the exact failure the A.1
alert exists to catch.

### Analytics — for Phase 8, not now

Record vendor activation as a measurable funnel:

```
signup → business setup → Stripe setup started → Stripe charge-ready
       → first product → first draft drop → first live drop → first paid order
```

The goal is knowing exactly where vendors abandon activation. **Do not implement
these events now** — they belong to Phase 8 and go through `lib/analytics.ts`
like everything else.

---

## PHASE 8 — Analytics and admin visibility

> ⛔ **Blocked.** Do not start Phase 8 until Phase 7 *and* the pay-in-person work
> are complete and verified. Phase 7 is done; pay-in-person is not.

### Settled before implementation — don't relitigate these

- **Use the existing `lib/analytics.ts` abstraction** for PostHog. Do not call
  PostHog from components; the provider stays swappable.
- **Env vars:** `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.
  Remember `NEXT_PUBLIC_*` is inlined at build time — setting it in Vercel
  requires a redeploy to take effect.
- **Identify authenticated customers by `Customer.id` only.**
- **Send no PII** — no name, email, phone, address, or anything else not
  strictly needed for the analysis.
- **The application database stays the source of truth for business metrics.**
  Revenue, order counts and vendor payouts are answered from Postgres, never
  from PostHog.
- **PostHog is for behavioural analytics** — funnels, feature usage, conversion
  analysis, session replay, experiments.
- **Inspect `Customer.firstVendorId`, `Customer.signupSource` and
  `CustomerVendor` first.** Phase 1 already models acquisition and the
  customer↔vendor relationship; do not build duplicate analytics infrastructure
  for facts the schema already records.

- [ ] 8.1 Fire the customer-lifecycle events (signup, guest checkout,
      conversion, follow, save, reorder) with vendor/drop/source context
- [ ] 8.2 **[YOU]** Point `/api/track` at a real pipeline — it currently
      `console.log`s to Vercel logs, which is fine for debugging and useless
      for analysis
- [ ] 8.3 Admin: customer growth, signup sources, guest→account conversion,
      top acquiring vendors, cross-vendor purchases
- [ ] 8.4 Vendor analytics: their followers, customers they brought in,
      repeat rate — scoped so a vendor never sees platform-wide data
- [ ] 8.5 **Vendor activation funnel** — `vendor_signup` →
      `vendor_stripe_setup_started` → `vendor_stripe_charge_ready` →
      `vendor_first_drop_created` → `vendor_first_drop_published` →
      `vendor_first_paid_order`, plus the diagnostic `vendor_publish_blocked`
      and `vendor_stripe_restricted`. Full vocabulary in
      `docs/VENDOR-ACTIVATION.md` §13. This is how we learn where activation
      breaks; today we only know the outcome (5 of 9 vendors not charge-ready),
      not the step they gave up on. Measuring whether **admin outreach** lifts
      activation additionally needs a contact timestamp — a V.Admin decision,
      not designed yet.

---

## Decisions — SETTLED

0. **Payments → stay on Stripe Connect DIRECT charges.** Vendor is merchant of
   record, pays Stripe processing, and bears refunds and chargebacks. DropQ
   carries no payment-processing financial exposure and keeps the full 2%.
   Destination charges + universal cross-vendor saved cards become a future
   **Payments v2** project, revisited only once DropQ has the transaction
   volume, vendor agreements, fraud controls, reserve/payout policy and cash
   reserves to absorb platform-level dispute liability. Two supporting facts:
   at 2%, plain destination charges are loss-making per order (~-$0.51 on $24),
   and `on_behalf_of` moves settlement but **not** dispute liability.

1. **Authentication → Auth.js.** Google OAuth, Apple OAuth, and email
   magic-link. UI stays fully DropQ-branded, and vendor/drop context survives
   the auth round trip. Don't build a custom framework. Note: the existing
   hand-rolled HMAC cookie serves *vendors* too, so Phase 6 has to migrate or
   bridge both principals without logging everyone out.

2. **Saved cards → Stripe Customers, but not a launch blocker.** Ship the
   current checkout as-is. Prepare the schema for `stripeCustomerId` on
   Customer now; add SetupIntent card management as a follow-up. Target
   experience is very fast repeat purchase and Buy Again.

3. **Rewards → $1 spent = 1 DropPoint.** No universal dollar value yet —
   points are an earned balance that later unlocks configurable rewards.
   Architect for two scopes from the start: DropQ-wide and vendor-specific
   (e.g. 100 pts → free item, 250 pts → $10 vendor credit). No complex loyalty
   economy at this stage.

4. **Analytics → PostHog.** Product analytics, funnels, acquisition
   attribution, drop/vendor conversion, DropMeet engagement, session replay,
   feature flags, experiments. Go through a thin in-app abstraction rather than
   calling PostHog from components, so the provider stays swappable.
   (`lib/analytics.ts` already is that seam — point it at PostHog.)

5. **Purchase ≠ Follow ≠ Marketing consent.** ✅ Implemented in Phase 1, with
   the consent columns added alongside SavedDrop. A purchase automatically
   records the relationship, first/last purchase date and order count. It never
   sets `followedAt` and never grants marketing consent. The model distinguishes
   all five states separately:

   | Concept | Where it lives |
   |---|---|
   | `has_purchased` | `CustomerVendor.orderCount > 0` |
   | `is_following` | `CustomerVendor.followedAt` |
   | `email_marketing_consent` | `CustomerVendor.emailMarketingConsent` |
   | `sms_marketing_consent` | `CustomerVendor.smsMarketingConsent` |
   | `push_notification_consent` | `CustomerVendor.pushNotificationConsent` |

   Post-checkout CTA ("Follow {Vendor} — get notified when they launch their
   next drop") lands in Phase 3.

## Decisions — OPEN

1. **What a DropPoint redeems for** — still unset, and deliberately so. Until
   there's an answer, `/my/rewards` states plainly that points aren't
   redeemable rather than implying a launch date.

## Decisions — SETTLED since the backfill

**Historical orders DO earn DropPoints** (decided and executed 2026-08-14).
All 8 pre-existing paid orders were backfilled at the corrected line-item rate.

The one design point worth preserving: those rows use **`reason: "purchase"`**,
not a separate backfill reason. Because the unique index is `(orderId, reason)`,
a distinct reason would be a *separate* row rather than a conflicting one —
which would have (a) stopped refunds reversing them, since
`reversePointsForOrder()` looks up `reason: "purchase"` exactly, and (b) allowed
a second award from `awardPointsForOrder()`. Provenance lives in `note`
(`"Earned before DropPoints launched"`) instead, which is queryable and reads
honestly to the customer.

**Any future ledger writer must follow the same rule** — pay-in-person awards
included. If a row represents a purchase award, its reason must be `"purchase"`
or refunds will not reverse it.

## Known gaps carried over

- [ ] Market schedule editor — 14 seeded markets have a day but no hours, and
      there's no UI to add them
- [ ] DropMeet candidate review UI — 4 candidates are quarantined with no way
      to action them in the admin queue
- [ ] Vendor profile "Find Us Around San Diego" — query exists, not wired into
      `/s/[slug]`
