# DropQ Phase V — Vendor Onboarding / Activation

**Status: V.0, V.1 and V.2 SHIPPED. V.3 / V.Admin / V.4 recorded, not started.**

Goal: a vendor should always know **what they've done, what's next, and when
they're ready to sell** — instead of discovering requirements when something
fails.

Verified against the repo at `fce62f4` and the **live production database**
(read-only). Where docs and repo disagreed, the repo won.

---

## 1. The current journey, step by step (VERIFIED)

### 1.1 Signup — `lib/actions/auth.ts:53`

Required: `storeName`, valid email, 8+ char password, **accept the Vendor
Agreement**. Optional: category (defaults `food`), invite code, plan choice.

Creates the `Seller` with `termsAcceptedAt` + `termsVersion` + a unique slug,
fires the verification email in the background, **creates the session
immediately**, and redirects to `/dashboard` (or Growth checkout).

⇒ **"Create your account" is 100% complete for every vendor the moment they sign
up.** Store name, category and terms are all captured there. There is no
separate "set up your store" requirement.

### 1.2 First dashboard visit — `app/dashboard/page.tsx`

- `app/dashboard/layout.tsx:26` — a **hard `TermsGate`** if
  `termsAcceptedAt` is null or `termsVersion` is stale. The only blocking gate
  in the dashboard.
- `layout.tsx:139` — `VerifyBanner`, a dismissible-by-verifying strip. **Email
  verification is never enforced**; login works unverified.
- `page.tsx:112` (Phase A) — `StripeRequiredBanner`.
- `page.tsx:68-110` — a **"Next step"** card with four branches: no drops → make
  one; new orders → prepare them; draft and no live → *"Your drop is ready to
  publish"*; live drop → all caught up.

### 1.3 Business/store setup — `lib/actions/dashboard.ts:109`

**Every field is optional.** `tagline`, `bio`, `location`, `logoUrl`,
`headerImageUrl`, `accent`, `timezone`, socials, `feeMode`, pickup contact,
geofence — all nullable or defaulted. `storeName` can't be blanked but is
already set at signup.

⇒ There is **no such thing as an incomplete store profile** in the current
architecture. Any "complete your profile" milestone would be an invented
requirement. The one field with real functional weight is **`timezone`**
(drop scheduling and `formatPickupWindow`), and even that falls back.

### 1.4 Stripe — `lib/actions/stripe.ts`

`connectStripeAction` creates an **Express** account, **saves
`stripeAccountId` immediately**, then redirects to a Stripe
`account_onboarding` link. So:

> `stripeAccountId != null` means **"setup started"**, *not* "finished".

`refreshStripeStatusAction` re-reads `charges_enabled` only.
`stripeDashboardAction` uses `accounts.createLoginLink`, which **only works for
a completed account** — for an incomplete one it errors to
`?error=dashboard`.

`app/dashboard/payments/page.tsx` already renders four states, and fetches
`account.details_submitted` live (line 28-42) to vary the copy between
"Stripe is reviewing your details" and "still needs a few details".
`details_submitted` is **not stored**.

### 1.5 Products

Two paths: the reusable library (`VendorProduct`, `/dashboard/products`) and
items typed directly into the drop editor (`Product`, created inline by
`createDropAction`). **A drop can be created with zero products** — the action
filters out blank name rows.

### 1.6 Drop creation and publishing

`createDropAction` → `resolveDropStatus` (Phase A). A non-charge-ready vendor's
live request is **downgraded to draft** with `?stripe_required=1`. Same gate in
`updateDropFullAction` and `updateDropStatusAction`. `live → closed/draft`
always allowed.

### 1.7 First paid order

`finalizePaidOrder` → `paymentStatus: "paid"`, DropPoints, commission, email.
Nothing anywhere marks activation complete.

---

## 2. Where it breaks down

### 2.1 🔴 The existing "Next step" card tells vendors to do the impossible

`app/dashboard/page.tsx:86` — when a vendor has a draft and no live drop:

> **"Your drop is ready to publish"** · *"Publish it to start taking orders and
> notify your followers."* → **Open the drop**

For a vendor without Stripe this is **false**, and it is the single most
prominent element on the dashboard. They follow it, hit the Phase A gate, and
get `?stripe_required=1`. That is precisely the "discover requirements only when
something fails" failure — and it is live right now for **Grandies**, who signed
up on 2026-08-15 with one draft drop and no Stripe.

The Phase A banner sits directly above it saying the opposite. Two adjacent
cards give contradictory instructions.

### 2.2 🔴 The real drop-off is *before* Stripe, not inside it

| Milestone | Vendors |
|---|---|
| account created | 9/9 |
| email verified | 7/9 |
| ≥1 product | 8/9 |
| ≥1 drop | 7/9 |
| ever published | 6/9 |
| **Stripe setup started (account exists)** | **4/9** |
| **Stripe charge-ready** | **4/9** |
| ≥1 paid order | 2/9 |

**`started` and `charge-ready` are the same 4 vendors.** Nobody has ever begun
Stripe onboarding and abandoned it partway. The funnel does not leak *inside*
Stripe — it leaks at the decision to click **Connect** at all.

That is a motivation-and-timing problem, not a flow problem, and it means the
intervention belongs in the dashboard and in the moments around drop creation —
**not** in a better Stripe wizard.

It also means **6 vendors built a drop and 6 published one, while 5 had no
Stripe.** Before Phase A those published drops were live storefronts that could
take free orders.

### 2.3 No sense of progress or completion

Nothing tells a vendor how far along they are, what remains, or that they're
finished. The Phase A banner says what's *wrong*; nothing says what's *done*.

### 2.4 Smaller gaps

- **"Open Stripe Dashboard" breaks for incomplete accounts** —
  `createLoginLink` requires a completed account; the incomplete branch
  correctly offers "Continue setup" instead, but the Phase A banner's
  *"Fix this in Stripe →"* points at `/dashboard/payments` for all states, which
  is right, while the **A.1 email** says "Fix this in payments settings" — also
  right. No bug, but the naming is inconsistent across three surfaces.
- **The "restricted" state renders as "Setup incomplete"** — a vendor who was
  selling and got restricted sees *"Finish connecting your account · You started
  onboarding but Stripe still needs a few details"*, which misdescribes their
  situation.
- **Email verification is surfaced but never required**, so it reads as noise.

---

## 3. Recommended activation model

### 3.1 Two distinct concepts, as separate as they actually are

| Concept | Definition | Derivation |
|---|---|---|
| **Ready to Sell** | DropQ can take money for this vendor | `isVendorSellable(seller)` — **Stripe charge-ready. That is the whole definition.** |
| **Selling** | a customer can buy right now | Ready to Sell **and** ≥1 `Drop.status === "live"` with ≥1 in-stock product |

**Ready to Sell is Stripe and nothing else.** It is the only hard requirement in
the codebase. Bundling profile fields or product counts into it would invent
requirements to pad a progress bar — explicitly out of scope, and it would also
make the badge lie about what actually blocks a sale.

### 3.2 The checklist — five milestones

| # | Milestone | Complete when | Today |
|---|---|---|---|
| 1 | **Create your account** | always — signup captures store name, category, terms | 9/9 |
| 2 | **Verify your email** | `seller.emailVerified` | 7/9 |
| 3 | **Connect Stripe** · *required to sell* | `isVendorSellable(seller)` | 4/9 |
| 4 | **Build your first drop** | ≥1 `Drop` owned by the seller with ≥1 `Product` | 7/9 |
| 5 | **Publish it** | ≥1 `Drop.status === "live"` (ever) | see §3.4 |

**Why "add a product" is not its own step.** Products are created *inside* the
drop editor — `createDropAction` takes parallel `p_name[]` arrays — so for most
vendors "add a product" and "create a drop" are the same keystrokes. A separate
step would be complete-by-accident for everyone who used the normal path. The
library (`VendorProduct`) is an alternative route to the same milestone, and
milestone 4 counts either.

**Why email verification is included but does not gate Ready to Sell.** It's a
real, already-surfaced completion step with a real action, so it belongs on the
checklist. It is *not* enforced anywhere, so it must not appear to block
selling. Render it without the "required to sell" marker.

**No milestone requires a profile field.** §1.3 proved there is no such thing as
an incomplete profile. A *suggestion* to add a logo/timezone can live as an
optional tip, never as an unchecked box.

### 3.3 Nothing is sequential

Any milestone can be completed in any order. The checklist reports state; it
never blocks navigation. A vendor can build drops all day with no Stripe — only
**publishing** is gated, and that gate already exists and is already tested.

### 3.4 One derivation caveat to resolve at build time

"Ever published" is not cleanly derivable: a drop can go `draft → closed`
without ever being live, so `status IN ('live','closed')` overstates it. Options,
cheapest first:

1. Treat **`status === "live"` now, or any paid order** as published. Slightly
   understates for vendors whose drop already closed.
2. Read `OrderEvent`/orders as proof the drop took orders.
3. Add `Drop.firstPublishedAt` — a new column for a cosmetic checkbox. **Not
   recommended.**

**Recommend option 1**, and treat milestone 5 as satisfied by
`hasLiveDrop || paidOrders > 0`.

---

## 4. Stripe state model

Five states. Four are derivable today from `lib/payments.ts`; the fifth is not.

| State | Derivation | Checklist | Vendor-facing message |
|---|---|---|---|
| **Not connected** | `stripeAccountId == null` | ○ | **Connect Stripe** — "DropQ uses Stripe to process card payments securely and pay you directly." |
| **Setup started, incomplete** | `stripeAccountId != null && !stripeChargesEnabled` *(and not §restricted)* | ◐ | **Finish Stripe setup** — → `connectStripeAction`, which mints a fresh onboarding link. **Never `createLoginLink`; it fails for incomplete accounts.** |
| **Submitted, under review** | as above **+** live `account.details_submitted` | ◐ | "Stripe is reviewing your details. This usually takes a few minutes." |
| **Charge-ready** | `isVendorSellable(seller)` | ✓ | **Ready to sell** |
| **Previously ready, now restricted** | ⚠️ **not derivable today** — see §4.1 | ⚠ | **Selling is paused** — "Stripe turned off card payments for your account. Your storefront isn't accepting orders." → Stripe |

All of this must go through the existing `lib/payments.ts` /
`sellerBlockReason()` / `StripeRequiredBanner` architecture from Phase A/A.1.
**Do not build a second Stripe-state system.** `sellerBlockReason()` already
returns `not_connected | charges_disabled | suspended`; Phase V refines
`charges_disabled` into *incomplete* vs *restricted*.

### 4.1 The single schema question

**"Was this vendor ever charge-ready?" cannot be answered from current data.**

The obvious heuristic — "they have paid orders, so they must have been ready" —
was tested against production and **fails for every affected vendor**:

```
Elias test              stripe=not_started  paidOrders=0  -> unknown
DropQ Admin             stripe=not_started  paidOrders=0  -> unknown
Marble & Crumb          stripe=not_started  paidOrders=0  -> unknown
California Vintage      stripe=not_started  paidOrders=0  -> unknown
Grandies                stripe=not_started  paidOrders=0  -> unknown
```

All five resolve to "unknown", so the heuristic distinguishes nothing.

**Recommendation: add one nullable column.**

```prisma
model Seller {
  /// First time Stripe reported charges_enabled. Never cleared — so
  /// `stripeChargesEnabledAt != null && !stripeChargesEnabled` means
  /// "was selling, now restricted", which is a different situation from
  /// "never finished onboarding" and needs different words.
  stripeChargesEnabledAt DateTime?
}
```

It earns its place twice: it is the **only** way to tell restricted from
never-finished, and it is the **time-to-Stripe-connection** metric the Phase 8
funnel needs (§7), which is otherwise unknowable for historical vendors.

- **Written by** the existing `account.updated` handler, which already detects
  the false→true transition (Phase A.1). One extra field on a write that
  already happens. Also set defensively by `refreshStripeStatusAction`.
- **Backfill:** set it for the 4 currently charge-ready vendors — they
  demonstrably are ready. `Seller.createdAt` is the honest floor; use it and say
  so in a note, or leave it and accept that historical time-to-Stripe is
  unknown. **Recommend backfilling to `createdAt`** only if the metric matters;
  otherwise backfill to `now()` and treat pre-Phase-V history as unmeasured.
- **This is the only schema change Phase V needs.** Everything else derives.

**Phase V can ship without it**, losing only the restricted-state copy and the
historical timing metric. If you'd rather keep Phase V zero-migration, say so
and I'll fold the column into Phase 8 instead.

---

## 5. Dashboard UX

### 5.1 Replace the "Next step" card — don't add alongside it

The existing card (§2.1) actively misleads. The **Get Ready to Sell** card should
**take its place** while activation is incomplete, so the dashboard never gives
two contradictory instructions.

```
┌──────────────────────────────────────────────────────────┐
│  Get ready to sell                          3 of 5 done  │
│  ████████████░░░░░░░░                                    │
│                                                          │
│  ✓  Create your account                                  │
│  ✓  Verify your email                                    │
│  ○  Connect Stripe                     Required to sell  │
│     Take card payments and get paid directly.            │
│                                    [ Connect Stripe → ]  │
│  ✓  Build your first drop                                │
│  ○  Publish it                                           │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- **One CTA only** — on the single next recommended action, chosen server-side
  (§5.2). Completed rows are quiet ticks; other incomplete rows are inert text.
- **Stripe is marked "Required to sell"**; nothing else is.
- Compact: one card, no wizard, no modal, no route change. Everything else on
  the dashboard stays reachable.

### 5.2 Next recommended action

First match wins:

1. not charge-ready **and** has a drop ready → **Connect Stripe** *("Your drop
   is ready — connect Stripe to publish it.")*
2. not charge-ready → **Connect Stripe**
3. no drop with products → **Build your first drop**
4. charge-ready with a drop, nothing live → **Publish your drop**
5. live drop, no orders → **Share your drop link** *(with the copy-link control
   that already exists)*
6. otherwise → nothing; activation is done

Rule 1 is the important one: it names the vendor's own blocked work as the
reason, which is what turns the Phase A gate from a surprise into an
expectation.

### 5.3 Lifecycle — no persistence, no dismiss state

| Vendor state | Dashboard |
|---|---|
| any milestone outstanding | full **Get ready to sell** card |
| all 5 done, **no** paid order | collapse to a single line — *"✓ Ready to sell — share your drop link"* + share CTA |
| **≥1 paid order** | **card gone entirely**; the normal "Next step" card returns |

Derived from live data, so there is no dismissed flag, no onboarding table, and
nothing to reset. It cannot go stale: a vendor whose Stripe is later revoked
correctly sees the card again — which is exactly right, because they genuinely
cannot sell.

---

## 6. Contextual nudges

Three, all cheap, all at moments the vendor is already succeeding — never
interruptive.

| Where | When | Message |
|---|---|---|
| After saving the first **product** (`/dashboard/products`) | not charge-ready | *"Product saved. Connect Stripe when you're ready to start selling."* |
| After saving a **draft drop** (`/dashboard/drops/[id]`) | not charge-ready | *"Drop saved as a draft. Finish Stripe setup to publish it."* |
| Drop editor, **publish control** | not charge-ready | Inline note beside the status control: *"Publishing needs Stripe."* Disable the live option rather than letting them pick it and be silently downgraded. |

The third is the highest-value: today a vendor can select "live", save, and be
downgraded with a `?stripe_required=1` banner *after the fact*. Showing it
up-front makes the Phase A gate unsurprising, which is the whole point of this
phase.

**The hard gate stays exactly as it is.** These are signposts in front of it, not
replacements for it.

---

## 7. Analytics specification (record for Phase 8 — do not implement)

Through `lib/analytics.ts`, identified by `Seller.id`, **no PII**.

| Event | Fires when | Properties |
|---|---|---|
| `vendor_signed_up` | `signupAction` completes | `plan`, `category`, `hasInviteCode`, `referredBySalesRep` |
| `vendor_email_verified` | `/verify` succeeds | `hoursSinceSignup` |
| `vendor_stripe_started` | `connectStripeAction` creates the account | `hoursSinceSignup` |
| `vendor_stripe_charge_ready` | `account.updated` flips false→true | `hoursSinceSignup`, `hoursSinceStripeStarted` |
| `vendor_stripe_restricted` | `account.updated` flips true→false | `hadLiveDrops`, `daysChargeReady` |
| `vendor_first_product` | first `VendorProduct`/`Product` | `via: "library" \| "drop_editor"` |
| `vendor_first_drop_created` | first `Drop` | `mode`, `productCount`, `chargeReadyAtTime` |
| `vendor_publish_blocked` | `resolveDropStatus` downgrades a live request | `reason: "not_connected" \| "charges_disabled"` |
| `vendor_first_drop_published` | first `Drop.status → "live"` | `hoursSinceSignup`, `hoursSinceChargeReady` |
| `vendor_first_paid_order` | first `finalizePaidOrder` for the seller | `hoursSinceSignup`, `source`, `totalCents` |
| `activation_completed` | all 5 milestones true | `hoursSinceSignup` |

**Funnel:** signup → email verified → Stripe started → charge-ready → first
product → first draft drop → first live drop → first paid order.

**Questions it must answer:** activation conversion rate; the exact step vendors
abandon; time to Stripe connection; time to first published drop; time to first
sale.

`vendor_publish_blocked` is not in your list but is the most diagnostic event
here — it is the moment a vendor hits the wall, and today we cannot count it.

Most of these are reconstructable from the database for *counts*; PostHog is for
*timing and ordering*. Per the roadmap, **Postgres stays the source of truth for
business metrics.**

---

## 8. Existing vendors

Everything is derived, so all 9 inherit correct state with **no backfill, no
migration of onboarding state, and no repeated work**:

| Vendor | Milestones | Sees |
|---|---|---|
| The Clovery | 5/5 + 5 paid orders | **nothing** — activation complete |
| Paraiso Delicacies | 5/5 + 3 paid orders | **nothing** |
| Casa Makulay | account, email, Stripe, drop ✓ · no live drop | *"Publish your drop"* |
| Britts Bunnies | account, email, Stripe ✓ · no drop | *"Build your first drop"* |
| Marble & Crumb | account, email, drop ✓ · **no Stripe** | *"Connect Stripe"* (demo store — see note) |
| California Vintage | account, email, drop ✓ · **no Stripe** | *"Your drop is ready — connect Stripe to publish it."* |
| Elias test | drop ✓ · **no Stripe, unverified** | *"Connect Stripe"* |
| DropQ Admin | account, email ✓ only | *"Build your first drop"* |
| Grandies | account ✓, draft drop · **no Stripe, unverified** | *"Your drop is ready — connect Stripe to publish it."* |

The two vendors who have actually sold see no onboarding UI at all — the single
most important property of a derived model.

**Note:** Marble & Crumb is the marketing showcase (`slug: marble-crumb`,
`isDemoStore`). It never takes real orders, so it should be excluded from
activation UI and from activation analytics, exactly as `app/admin` already
excludes it.

---

## 9. Implementation plan

Four small phases. **No migration at all unless V.1 is approved.**

### V.0 — `lib/activation.ts`, pure and unused
Derivation only: `activationState(seller, counts)` → the five milestones, the
next recommended action, and the lifecycle stage. Extends `lib/payments.ts`;
does not duplicate it. Unit-tested against all nine production vendor shapes.
**No UI, no schema, zero risk.**

### V.1 — `Seller.stripeChargesEnabledAt` *(optional; skip to keep Phase V zero-migration)*
One nullable column + write it from the existing `account.updated` transition
and `refreshStripeStatusAction`. Backfill the 4 charge-ready vendors.
**DB:** one additive nullable column, 4-row backfill, no destructive op.
**Tests:** content-hash all business tables; transition writes it once and never
clears it; `restricted` distinguishable from `not_connected`.

### V.2 — Dashboard card
Render **Get ready to sell**, **replacing** the misleading "Next step" card
while activation is incomplete; collapse when done; hide after first paid order.
**Tests:** all nine vendor shapes render the expected state; a vendor with paid
orders sees nothing; a charge-ready vendor with no drop is told to build one;
Grandies is told Stripe blocks their draft.

### V.3 — Contextual nudges + publish-control state
The three §6 nudges, and disable the "live" option in the drop editor for
non-charge-ready vendors with an inline explanation.
**Tests:** the Phase A gate still fires server-side even if the control is
re-enabled client-side — **hiding the option is not the enforcement**;
`test:phase-a` stays green.

### V.4 — Analytics stubs *(deferred to Phase 8)*
Event names and properties only, behind `lib/analytics.ts`. No PostHog.

### Sequencing
```
V.0 ──▶ V.1 (optional) ──▶ V.2 ──▶ V.3        V.4 with Phase 8
```

### Does Phase V need a schema change?

**No — except for the one optional column in V.1.** Milestones 1, 2, 4 and 5 and
the entire lifecycle derive from `Seller`, `Drop`, `Product`, `VendorProduct` and
`Order`. `stripeChargesEnabledAt` buys exactly two things: honest "restricted"
copy, and historical time-to-Stripe. Both are real; neither is load-bearing.
**Your call.**

---

## 10. V.0 — as shipped

`lib/activation.ts` (server-only, pure derivation) +
`app/api/dev/activation-selftest/route.ts` (**63 assertions, 404s in
production, writes nothing**). No schema change. Nothing renders it yet.

### 10.1 The API

```ts
stripeActivationState(seller, hasEverSold?) → "suspended" | "not_started"
                    | "incomplete" | "restricted" | "unknown" | "charge_ready"
stripeBlocksSelling(state)                  → boolean
activationState(seller, facts)              → ActivationState
activationFacts(sellerId)                   → { dropsWithProducts, liveDrops, paidOrders }
loadActivationState(seller)                 → ActivationState
```

`ActivationState` carries `applicable` (false for demo stores), the five
`milestones`, `completed`/`total`, `readyToSell`, `stripe`, `stage`
(`activating` | `ready_no_sale` | `complete`) and a single `nextAction`.

**One derivation, reused everywhere.** V.2's dashboard card, V.3's nudges and
V.Admin all consume this; none of them re-derive activation rules. It imports
`isVendorSellable` from `lib/payments.ts` rather than restating the Stripe rule.

**It derives; it never enforces.** The authoritative gate remains
`isVendorSellable()` inside `placeOrderAction` and `resolveDropStatus`. Phase A
is untouched — `test:phase-a` stays 77/77.

### 10.2 A sixth Stripe state exists: `unknown`

Design §4 listed five. Implementation needs a sixth for vendors who were
charge-ready **before V.1 starts recording the timestamp**:
`stripeAccountId != null && !chargesEnabled && stripeChargesEnabledAt == null`.

They are **not** misclassified as `not_started` — that requires
`stripeAccountId == null`. `unknown` maps to the same "Setup incomplete →
Continue setup" copy the payments page already shows, which is safe and correct
enough. See §11.3 for exactly how much exposure this is.

`stripeChargesEnabledAt` is typed **optional** in `SellerActivationFields`, so
V.0 compiles and behaves correctly against today's schema and V.1 is purely
additive.

### 10.3 What the nine production vendors derive today

Verified by the selftest against live data:

| Vendor | State | Progress | Stage | Next action |
|---|---|---|---|---|
| The Clovery | charge_ready | 5/5 | complete | — |
| Paraiso Delicacies | charge_ready | 5/5 | complete | — |
| Casa Makulay | charge_ready | 4/5 | activating | publish |
| Britts Bunnies | charge_ready | 3/5 | activating | build a drop |
| California Vintage | not_started | 3/5 | activating | **Stripe** |
| Marble & Crumb | not_started | 3/5 | activating | **EXCLUDED** (demo store) |
| Grandies | not_started | 2/5 | activating | **Stripe** |
| Elias test | not_started | 2/5 | activating | **Stripe** |
| DropQ Admin | not_started | 2/5 | activating | **Stripe** |

The two vendors who have actually sold see nothing. Grandies gets exactly the
message you asked for: *"Your drop is ready. Connect Stripe to publish it."*

### 10.4 ⚠️ Local dev runs with the Stripe gate wide open

The local `.env` has `STRIPE_SECRET_KEY=` **with an empty value**, so
`isStripeEnabled()` is false and `isVendorSellable()` returns true for
*everyone* — the documented local-dev escape hatch. The first selftest run
reported all nine vendors as `charge_ready`.

**Anyone testing Phase A or activation locally will see no gating at all unless
they set a dummy key:**

```
STRIPE_SECRET_KEY=sk_test_dummy npm run dev
curl localhost:3000/api/dev/activation-selftest
```

Nothing in the activation or gating path calls Stripe, so a dummy value is safe.

---

## 11. V.1 — as shipped

### 11.1 Schema change

```prisma
model Seller {
  // ...
  stripeAccountId      String? @unique
  stripeChargesEnabled Boolean @default(false)
  /// The FIRST time this seller became Stripe charge-ready. An activation
  /// timestamp, NOT current status — stripeChargesEnabled stays authoritative.
  /// Set once on the first false->true transition; never overwritten, never
  /// cleared. NULL for vendors already charge-ready before this column existed.
  stripeChargesEnabledAt DateTime?
}
```

### 11.2 Migration as applied

`20260815042013_add_seller_stripe_charges_enabled_at`, applied with
`migrate deploy`. The generated SQL was re-confirmed against the live database
immediately before applying and was byte-identical to the reviewed version —
**exactly one DDL statement**:

```sql
-- AlterTable
ALTER TABLE "Seller" ADD COLUMN     "stripeChargesEnabledAt" TIMESTAMP(3);
```

One nullable column. No index, no constraint, no default, no rewrite. Postgres
adds a nullable column without a table rewrite, so this is instant on 9 rows and
would still be instant on nine million.

### 11.3 Existing rows and the backfill recommendation

**Recommendation: backfill nothing. Leave all 9 NULL.**

I looked for a defensible historical date for the four charge-ready vendors:

| Vendor | Account created | First paid order | Best evidence |
|---|---|---|---|
| The Clovery | 2026-06-24 | 2026-07-30 | ready *by* 2026-07-30 — a **36-day** window |
| Paraiso Delicacies | 2026-06-22 | 2026-07-04 | ready *by* 2026-07-04 — a **12-day** window |
| Casa Makulay | 2026-06-12 | none | **no evidence** |
| Britts Bunnies | 2026-06-12 | none | **no evidence** |

The strongest available signal is an *upper bound* off by up to 36 days, and it
doesn't exist for half of them. Stripe can't supply it either: `account.created`
is when onboarding *started*, and Stripe retains events for roughly 30 days, so
the June/July `account.updated` transitions are long gone. *(Unverified from
here — the local Stripe key is empty, §10.4. Worth a console check if you want
to be certain before deciding.)*

Writing `Seller.createdAt` or `now()` would fabricate an activation date and
corrupt the very time-to-activation metric the column exists to feed. Per your
instruction, an honest unknown beats a fabricated date.

**Does NULL misclassify a currently-active vendor as never-activated?**
**No** — and this is implemented and tested, not assumed:

- `charge_ready` is decided by `isVendorSellable()`, which never reads the
  timestamp. All four legacy vendors read `charge_ready` today.
  *(Test: "legacy charge-ready with no timestamp still reads charge_ready".)*
- `not_started` requires `stripeAccountId == null`. All four have accounts, so
  none can ever fall into it.

**The only residual exposure** is a legacy vendor becoming restricted *later*:
they'd read `unknown` instead of `restricted`. That is bounded to **two
vendors** — Casa Makulay and Britts Bunnies — because V.0 already treats a
completed Stripe payment as proof of prior readiness, which covers The Clovery
and Paraiso. *(Test: "a completed sale proves prior readiness -> restricted".)*

And for those two the degradation is mild:

- copy falls back to today's "Setup incomplete → Continue setup"
- `connectStripeAction` mints a fresh onboarding link, which is the correct
  destination for a restricted account anyway
- **the Phase A.1 email still fires**, because it triggers on the
  `account.updated` transition and never reads the timestamp — so they are still
  told selling is paused
- it self-corrects permanently the first time they become charge-ready again

### 11.4 Exactly-once write behaviour

The Phase A.1 handler already detects the transition atomically. V.1 extends
that one write:

```ts
const flipped = await prisma.seller.updateMany({
  where: { stripeAccountId: account.id, stripeChargesEnabled: !chargesEnabled },
  data: {
    stripeChargesEnabled: chargesEnabled,
    // First activation only. `null` in the predicate means the row is only
    // matched while unset, so a later re-activation cannot overwrite it.
    ...(chargesEnabled ? { stripeChargesEnabledAt: new Date() } : {}),
  },
});
```

⚠️ The spread above sets it on **every** false→true transition, which would
overwrite the original on re-activation. The exactly-once form is a **second,
separately-predicated update**:

```ts
if (flipped.count > 0 && chargesEnabled) {
  await prisma.seller.updateMany({
    where: { stripeAccountId: account.id, stripeChargesEnabledAt: null },
    data:  { stripeChargesEnabledAt: new Date() },
  });
}
```

`stripeChargesEnabledAt: null` in the predicate is the guard: the row matches
only while the column is unset, so the **first** activation wins and every later
one matches zero rows. Same single-winner primitive as `finalizePaidOrder`.

Against your four required semantics:

| Transition | Behaviour |
|---|---|
| first `false → true` | set, because the row still matches `At IS NULL` |
| `true → false` | outer update runs, inner guarded by `chargesEnabled` — **preserved** |
| later `false → true` | inner update matches 0 rows — **original preserved** |
| never overwritten | guaranteed by the predicate, not by application logic |

`refreshStripeStatusAction` (the manual "Refresh status" button) should get the
same guarded write, so a vendor who activates while a webhook is delayed is
still stamped.

### 11.5 Production impact and rollback

- **Impact:** one nullable column on 9 `Seller` rows, all NULL. No existing
  value read or written. No behaviour change — nothing consumes the column until
  V.2, and V.0 already handles it being absent.
- **Backfill:** none.
- **Destructive operations:** none. No `--accept-data-loss`.
- **Rollback:** `ALTER TABLE "Seller" DROP COLUMN "stripeChargesEnabledAt";` plus
  deleting the migration directory. Safe unconditionally — the column carries no
  data anything depends on, and V.0 treats it as optional.
- **Verification:** content-hash all business tables before/after (the hash
  *will* change for `Seller` because the row shape gains a key — compare the
  other nine tables byte-for-byte and diff `Seller` field-by-field excluding the
  new column); `migrate status` clean; drift empty; selftest 63/63;
  `test:phase-a` 77/77.

---

## 12. V.Admin — Vendor Activation Operations (recorded, not started)

### 12.1 It should be its own sub-phase

**Recommendation: a separate `V.Admin`, sequenced after V.2.**

It is not V.2 (a different audience, a different route tree, `requireAdmin()`
not `requireSeller()`) and not V.3 (nothing contextual about it). But it depends
on V.0's derivation and reads best after V.2 has proven that derivation against
real vendors. It is also the phase with the **highest immediate business value**:
five of nine vendors cannot sell, and right now nobody at DropQ can see that
without a database query.

### 12.2 States — the same model, no second system

Admin reuses `stripeActivationState()` verbatim. No admin-only Stripe vocabulary.

| Admin label | Derivation |
|---|---|
| **Ready** | `charge_ready` |
| **Restricted** | `restricted` |
| **Setup in progress** | `incomplete` / `unknown` — only meaningful because `stripeAccountId` exists. **Today this bucket would always be empty:** production has zero vendors who started Stripe and stopped (§2.2). |
| **Not started** | `not_started` |

### 12.3 Outreach priority — from real behaviour, not tiers invented up front

The signal that matters is **effort already invested without payments**, because
that vendor has demonstrated intent and is one conversation from selling.

| Priority | Rule | Today |
|---|---|---|
| **High — needs attention** | not charge-ready **and** has a drop with products | California Vintage, Grandies, Elias test |
| **Medium** | not charge-ready **and** has products or profile content but no drop | — |
| **Low** | not charge-ready, little activity | DropQ Admin |
| **Watch** | `restricted` — was selling, now cannot | none yet, and the most urgent if it ever appears |
| **None** | `charge_ready` | Clovery, Paraiso, Casa Makulay, Britts Bunnies |

*"Created a drop but no Stripe"* is the headline signal, exactly as you framed
it. Note it currently describes **three of nine vendors** — a third of the base
is one Stripe conversation away from being able to sell.

**Do not alert on brand-new signups.** Grandies signed up and built a drop
within two minutes; an immediate alert would be noise. Suggest a threshold —
*reached the high-priority state and stayed there for 24h* — tuned once there is
enough volume to know what "stuck" looks like.

### 12.4 The view

Extend the existing `/admin` vendor list rather than building a parallel tool —
it already lists vendors with counts and already excludes the demo store.

Columns: vendor · signup date · activation state · ever charge-ready ·
milestones (`3/5`) · products / drops · has attempted to publish · priority ·
link to the vendor detail page · mailto.

"Has attempted to publish" becomes genuinely knowable once V.3 emits
`vendor_publish_blocked`; until then it can only be inferred from a draft drop
on a non-charge-ready vendor.

**Manual outreach only.** No automated email or SMS campaigns, no "contacted"
tracking, no CRM. Those are separate decisions.

---

## 13. Analytics — approved event vocabulary (Phase 8, do not implement)

Core funnel, using your names:

```
vendor_signup → vendor_stripe_setup_started → vendor_stripe_charge_ready
              → vendor_first_drop_created   → vendor_first_drop_published
              → vendor_first_paid_order
```

Plus the diagnostics:

| Event | Fires | Properties |
|---|---|---|
| `vendor_publish_blocked` | `resolveDropStatus` downgrades a live request | `reason` (`not_started`/`incomplete`/`restricted`), `hasProducts`, `hoursSinceSignup` |
| `vendor_stripe_restricted` | `account.updated` true→false | `hadLiveDrops`, `daysChargeReady` |
| `vendor_email_verified` | `/verify` succeeds | `hoursSinceSignup` |
| `activation_completed` | all five milestones true | `hoursSinceSignup` |

To measure whether **admin outreach** improves activation, the minimum is a
timestamped record of contact. That implies either a lightweight `contactedAt`
on the admin view or an `admin_vendor_contacted` event — **a V.Admin follow-up
decision, deliberately not designed here.** Without it, outreach effectiveness
is unmeasurable.

Emit nothing for `isDemoStore` vendors. Identify by `Seller.id`, no PII.
Postgres stays the source of truth for counts; PostHog answers timing and
ordering.

---

## 14. V.1 — shipped

`20260815042013_add_seller_stripe_charges_enabled_at`, applied 2026-08-15 with
`migrate deploy`. **One nullable column. No backfill. No other table touched.**

### 14.1 Verification

- Generated SQL re-confirmed identical to the reviewed version immediately
  before applying — one `ALTER TABLE ... ADD COLUMN`, nothing else.
- `migrate status` clean (4 migrations) · drift check `-- This is an empty
  migration.`
- **All 9 sellers have `stripeChargesEnabledAt = NULL`.** No backfill ran.
- **Every existing `Seller` field is byte-identical.** Hashing all nine rows
  *excluding* the new column reproduces the pre-migration hash exactly
  (`60696e8b0ff990f3`). The other nine business tables are unchanged outright.
- Activation selftest **75/75** · `test:phase-a` **77/77** · `tsc` clean ·
  `next build` clean.

### 14.2 The six transition cases, proven against the real table

Not modelled — the selftest runs the exact predicates the webhook ships, against
the live `Seller` table, inside a transaction that always rolls back (verified:
all rows still NULL afterwards).

| Case | Result |
|---|---|
| first `false → true` flips the row | ✓ |
| first `false → true` **sets** the timestamp | ✓ |
| `true → true` is a no-op (0 rows flipped) | ✓ |
| `true → false` **preserves** the timestamp | ✓ |
| later `false → true` does **not** overwrite it | ✓ |
| the test wrote nothing to production | ✓ |

Plus the legacy cases: a charge-ready vendor with a NULL timestamp still derives
`charge_ready` and `readyToSell: true`; `not_started` is reachable **only** via a
null `stripeAccountId`; a legacy account that loses charges reads `unknown` and
is told *"Finish Stripe setup"*, never "Connect Stripe" from scratch; and
current sellability is provably independent of the timestamp.

### 14.3 Where it is written

Two places, both predicated on `stripeChargesEnabledAt: null` so the **first**
activation wins:

- `app/api/stripe/webhook/route.ts` — a **second, separately predicated**
  `updateMany` after the A.1 transition detector. Folding it into that one update
  would re-stamp on every re-activation, which is the bug this shape avoids.
- `lib/actions/stripe.ts` `refreshStripeStatusAction` — same guarded write, so a
  vendor who hits "Refresh status" during a webhook delay is still recorded.

### 14.4 No historical backfill — final

All 9 rows are NULL and stay that way. The best available evidence for the four
charge-ready vendors was an upper bound off by 12–36 days, and two had none at
all (§11.3). Seller creation date, first paid order, Stripe account creation and
inferred windows were all considered and rejected as fabrication.

The `unknown` state (§10.2) is what makes NULL honest rather than wrong.

---

## 15. V.2 — shipped

`components/vendor-activation-card.tsx` + wiring in `app/dashboard/page.tsx`.
No schema change. **Guidance only** — Phase A's server gates are still the sole
enforcement, and `test:phase-a` stays 77/77.

### 15.1 It supersedes, it does not stack

`showsGenericNextStep(state)` gates **both** the old "Next step" card and the
`StripeRequiredBanner` on the dashboard home. Whenever the activation module
renders anything, both are suppressed — so the §2.1 contradiction (*"Connect
Stripe to start selling"* directly above *"Your drop is ready to publish"*)
cannot occur. The banner stays untouched on `/dashboard/drops*`, where there is
no activation card.

### 15.2 Four modes, derived not hard-coded

`activationCardMode(state)` lives in `lib/activation.ts` so V.3 and V.Admin ask
the same question. The component decides nothing.

| Mode | When | UI |
|---|---|---|
| `full` | can't sell, never sold | checklist, progress bar, one CTA |
| `paused` | got past onboarding, Stripe has since stopped them | one focused "Selling is paused" message |
| `compact` | can sell, no order yet | single line — *"✓ Ready to sell · <next>"* |
| `hidden` | selling and has sold, or a demo store | nothing; normal dashboard returns |

### 15.3 ⚠️ `ActivationStage` was corrected in V.2

V.0 derived `stage: "complete"` from `paidOrders > 0` alone. That was wrong for
the case your brief calls out: **a vendor who sold and was then restricted would
have vanished from activation UI entirely**, despite their storefront being
down. Equally, running them back through a five-step onboarding checklist they
finished months ago would be insulting.

So `!readyToSell` now outranks past success, and splits:

```
!readyToSell && (restricted || hasEverSold)  -> "paused"   (focused message)
!readyToSell                                 -> "activating" (checklist)
readyToSell && hasEverSold                   -> "complete"  (hidden)
readyToSell                                  -> "ready_no_sale" (compact)
```

Safe to change: V.0 was inert, nothing consumed it. Tested both ways —
*"restricted AFTER selling reappears as paused, not hidden"* and *"a restricted
vendor is never shown the 5-step checklist"*.

### 15.4 Tests — 95/95

All nine required scenarios plus the regressions:
not-started/no-drop → full · not-started/draft → full · charge-ready/no-drop →
compact · charge-ready/draft → compact · published-unsold → compact ·
first-paid-order → hidden · restricted → paused · legacy-unknown → full ·
demo store → hidden.

Plus: the generic Next-step card is suppressed whenever activation shows and
returns once selling; **the Grandies state is told to connect Stripe, is never
told to publish, and its CTA points at `/dashboard/payments`**; a vendor with an
existing Stripe account is never told to "Connect Stripe" from scratch; and card
mode provably never affects `readyToSell`.

### 15.5 Verified against real vendors

Rendered locally against the **production database** with real vendor sessions:

| Vendor | Rendered |
|---|---|
| **Grandies** (draft drop, no Stripe) | *Get ready to sell · 2 of 5 complete* · ✓ account · ○ email · ○ **Connect Stripe** `Required to sell` · ✓ build a drop · ○ publish · *"Your drop is ready. Connect Stripe to publish it."* → **Connect Stripe** |
| The Clovery (5 paid orders) | activation hidden; normal "Next step" card returns |
| Casa Makulay (charge-ready, unsold) | compact *"✓ Ready to sell"* |
| Britts Bunnies (charge-ready, no drop) | compact *"✓ Ready to sell"* |
| Marble & Crumb (demo store) | activation excluded; normal dashboard + Stripe banner |

**No vendor rendered the publish contradiction.** No production data was
modified — sessions were minted locally against read-only page renders.

The `paused` variant is covered by tests but **not yet observed in production**:
it needs Stripe to actually restrict a vendor, and none is restricted today.
