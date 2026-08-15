# DropQ In-Person Payments — Architecture

**Status: APPROVED 2026-08-14. Phase A SHIPPED. Phases B–G not started.**

The architecture, the two decisions in §10 and the seven-phase shape in §12 are
signed off. **Phase A is implemented, tested and deployed** — see §14 and §15.
No schema change, no migration and no production data change has occurred.
Phases B and later each require their own approval.

Governing principles:

> **1. Stripe is a platform requirement, not a vendor option.**
> A vendor is not fully active on DropQ until Stripe is connected and
> charge-ready. DropQ does not support alternative payment processors. "Vendor
> without Stripe" is an **incomplete-onboarding / selling-disabled state**, not
> a payment mode.
>
> **2. Every DropQ order is paid by card through DropQ/Stripe.**
> Cash is invisible to DropQ. There is no "pay later" and no external payment
> state.

What principle 1 requires, everywhere:

- A vendor who is not charge-ready **cannot accept online orders**.
- A vendor who is not charge-ready **cannot start walk-up card sales**.
- A vendor who is not charge-ready **cannot publish a drop live**.
- **No production fallback may create a real unpaid order because Stripe is
  unavailable.** The `Demo mode (no Stripe configured)` branch must never serve
  a real production vendor.
- If Stripe is disconnected or stops being charge-ready — including **after**
  a drop is already live — ordering is disabled until the vendor fixes it.
- Vendor UI must say plainly that Stripe setup is required before selling.
- A customer must never be shown a checkout that cannot complete payment.

Two — and only two — payment paths exist:

| Path | Who starts it | Where the customer is | Payment |
|---|---|---|---|
| **Online order** | customer | anywhere | Stripe via DropQ |
| **Walk-up order** | **vendor** | standing at the booth | Stripe via DropQ, on the customer's own phone |

Both are ordinary Stripe transactions. Both earn the normal DropQ fee, award
DropPoints, build the customer↔vendor relationship, refund through Stripe, and
appear in reporting. The only difference is **purchase origin**, recorded on
`Order.source`.

Everything in §1 was verified against the repo at `896536d` and against the
**live production database** (read-only queries only). Where the handoff and the
repo disagreed, the repo won.

> **Revision note.** An earlier draft of this document designed a
> "Mark Paid Externally" flow with cash/Venmo/Zelle payment states, external
> refunds and a manual paid-attestation audit trail. That model is **withdrawn**
> — cash is deliberately outside DropQ. Nothing in this document depends on it.

---

## 0. Pre-flight verification

| Check | Result |
|---|---|
| `git rev-list --left-right --count origin/main...HEAD` | `0  0` — in step |
| Working tree | clean |
| `prisma migrate status` | "Database schema is up to date", 2 migrations |
| `prisma migrate diff` vs live DB | `-- This is an empty migration.` — **no drift** |
| Phase 7 `PointsLedger` | exists, live |
| Historical DropPoints backfill | **complete** — 8 rows, 112 points, every row `reason: "purchase"` with the historical note |

Phase 8/PostHog untouched.

---

## 1. How payment actually works today (VERIFIED)

### 1.1 The `Order` row

`prisma/schema.prisma:374-408`:

| Field | Type | Notes |
|---|---|---|
| `status` | `String @default("new")` | `pending \| new \| in_progress \| ready \| completed \| canceled` (+ legacy `fulfilled`) |
| `paymentStatus` | `String @default("unpaid")` | 6 values written, 3 rendered — §1.2 |
| `source` | `String @default("online")` | `online \| live` |
| `buyerName` / `buyerEmail` | `String` | **NOT NULL** — see §3.1, this constrains the whole design |
| `buyerPhone` | `String?` | optional since the A2P work |
| `customerId` | `String?` | link to the durable `Customer` |
| `dropId` | `String` | **NOT NULL**, required relation — every order belongs to a drop |
| `totalCents` / `feeCents` | `Int` | `feeCents` written at creation, before payment |
| `stripeSessionId` | `String? @unique` | one session per order, ever |
| `stripePaymentIntentId` | `String?` | |

Absent: `paidAt`, `paymentMethod`, `refundedAt`, any actor field.
**`Drop.allowPayInPerson` does not exist** — proposed in the handoff, never
built, and **no longer needed** under this model.

### 1.2 `paymentStatus` — six written, three rendered

`unpaid` · `pending` · `paid` · `refund_pending` · `refunded` · `expired`.
`paymentLabel()` (`lib/orders.ts:45`) knows only `paid`, `unpaid`, `pending`;
the other three render as raw strings.

**And `unpaid` is labelled `"Pay in person"`** — which under the new model is
actively wrong copy for what is simply an unpaid order.

### 1.3 The Stripe pipeline

Connect **direct charges** on the vendor's connected account (unchanged, per the
settled Payments-v2 decision):

```
lib/actions/order.ts:169  stripe.checkout.sessions.create({...},
                            { stripeAccount: drop.seller.stripeAccountId })
                          payment_intent_data.application_fee_amount = feeCents
                          metadata.orderId          ← on both session and PI
                          expires_at = now + 60 min
                          success_url /order/{id}?session_id={CHECKOUT_SESSION_ID}
```

`finalizePaidOrder(orderId, paymentIntentId)` (`lib/checkout.ts:26`) is reached
from three callers — the webhook, the success page, and
`reconcilePendingOrders()`. In one transaction: atomic claim → OrderEvent →
conditional inventory increment with oversell rollback. Then outside the
transaction: DropPoints, sales-rep commission, confirmation email.

### 1.4 The `finalizePaidOrder` claim — and why the new model sidesteps it

```ts
// lib/checkout.ts:32
const claimed = await tx.order.updateMany({
  where: { id: orderId, status: "pending" },     // ← keyed on status
  data: { status: "new", paymentStatus: "paid", ... },
});
if (claimed.count === 0) return { state: "done" };
```

The pattern is correct — a conditional `updateMany` is atomic under Postgres
READ COMMITTED and exactly one caller can win. The predicate only works for
orders that were created `pending`.

An earlier draft treated this as a required refactor, because it planned to pay
*already-placed* (`status: "new"`) orders. **The walk-up model in §3 creates
every payable order as `status: "pending"`, so this function keeps working
untouched.** That is a deliberate design goal, not a happy accident — see §4.

The related invariant, which must be preserved: **`status === "pending"` ⇔
"stock not yet claimed."** The Stripe branch creates pending orders with stock
unclaimed and `finalizePaidOrder` claims it on payment; the non-Stripe branch
(`lib/actions/order.ts:224-232`) claims stock immediately and creates the order
`status: "new"`. Undocumented today and load-bearing.

### 1.5 🔴 `payInPerson=1` — an unauthenticated free-order bypass

```ts
// lib/actions/order.ts:89
const payInPerson = String(formData.get("payInPerson") ?? "") === "1";
const useStripe = !!stripe && seller.stripeChargesEnabled
                  && !!seller.stripeAccountId && !payInPerson;
```

The server **never checks `drop.mode`**. The UI renders the button only when
`live && paymentsEnabled` (`components/storefront-order.tsx:408`), but hiding a
button is not authorization. Any customer can post `payInPerson=1` to any drop
and receive a confirmed order, decremented inventory, and a
"Got your order! 🎉" text and email — **with no payment**.

Unexploited only because production has never had a live drop.

### 1.6 🔴 The Stripe-required rule is stated in the UI but enforced nowhere

Governing principle 1 is already DropQ's product intent — the vendor dashboard
literally says so at `app/dashboard/page.tsx:112-127`:

```ts
const stripeNeedsSetup = isStripeEnabled() && !seller.stripeChargesEnabled;
// "⚠️ Finish setting up payments to start selling"
```

**But nothing enforces it.** The banner is advisory; every selling surface
happily proceeds without Stripe. Three enforcement gaps, in the order the vendor
encounters them:

**(a) A drop can be published live with no Stripe.** `Drop.status` is written by
three actions — `createDropAction:341`, `updateDropFullAction:428` and
`updateDropStatusAction:527` — and **not one checks Stripe**. So a vendor who
has never connected Stripe can publish a live drop, and DropQ will render a
public storefront with a working-looking checkout. (`updateDropStatusAction:527`
additionally writes `status` straight from the form with no whitelist, unlike
its two siblings.)

**(b) Checkout then falls into the demo branch.** `useStripe` is false whenever
*the vendor* lacks Stripe, so execution reaches:

```ts
// lib/actions/order.ts:222
// ----- Demo mode (no Stripe configured): finalize immediately -----
```

That comment describes the **platform** having no `STRIPE_SECRET_KEY`. In
production the key *is* set, so the branch is only ever reached because a
**vendor** isn't charge-ready — and it silently takes a real, free,
inventory-consuming order and emails the customer a confirmation.

**(c) 🔴 Charge capability can be revoked mid-drop, silently.** This is the
dangerous one, and it is not an onboarding case at all. The `account.updated`
webhook (`app/api/stripe/webhook/route.ts:126-132`) writes:

```ts
data: { stripeChargesEnabled: !!account.charges_enabled }
```

Stripe disables charges routinely — unverified identity, an expired document, a
risk review. When that lands, a vendor **with a live drop and real customers**
flips to not-charge-ready and their storefront **starts taking free orders
immediately**, with no alert to the vendor and nothing in the UI that looks
different to the customer. The advisory banner appears on the dashboard home,
which a vendor mid-market has no reason to be looking at.

So the "vendor without Stripe" population is not just the four who never
onboarded — it is **any vendor, at any moment, including mid-drop**.

**Production today:** 4 vendors of 8 are not charge-ready (Elias test, DropQ
Admin, Marble & Crumb, California Vintage Sales), all with **zero orders** and
zero live drops. Closing this is therefore free right now — and it is the same
defect class as §1.5, so removing `payInPerson` without closing it just moves
the hole one line down the same function.

### 1.7 🔴 The customer↔vendor relationship is recorded before payment

`lib/actions/order.ts:114-138` calls `applyFirstTouch` and
`recordRelationship({ purchase: ... })` **before** the Stripe branch — so
`CustomerVendor.orderCount` and `totalSpentCents` increment for checkouts that
are abandoned and never paid, and `Customer.firstPurchaseAt` is set for someone
who never purchased.

Harmless-ish online (production currently has zero abandoned checkouts). **Not
harmless for walk-up sales**, where a customer wandering off mid-QR is a routine
occurrence at a market. This must move to payment time — plan item 8.

### 1.8 Eligibility is computed twice, by hand

| Where | Expression |
|---|---|
| `app/s/[slug]/[dropId]/page.tsx:94` | `isStripeEnabled() && seller.stripeChargesEnabled && !!seller.stripeAccountId` |
| `lib/actions/order.ts:92` | `!!stripe && seller.stripeChargesEnabled && !!seller.stripeAccountId && !payInPerson` |

Two independent copies. They agree today. Nothing links them.

### 1.9 There is no vendor refund. At all.

`stripe.refunds.create` appears **once**, inside the private
`refundOversoldOrder()` (`lib/checkout.ts:156`). `updateOrderStatusAction`
setting `canceled` voids the sales-rep commission and texts the customer — **it
refunds nothing**. Today, canceling a paid order keeps the customer's money.

Pre-existing. It means plan item 9 (Stripe refunds) is greenfield, not a
modification.

### 1.10 Reporting keys on `status`, never on payment

| Surface | Filter |
|---|---|
| `app/dashboard/payments/page.tsx:47` | `status IN (new, in_progress, ready, completed, fulfilled)` |
| `app/dashboard/analytics/page.tsx:36` | `status IN PAID` |
| `app/admin/page.tsx:70` | `status IN PAID` → **GMV and `dropqRevenue`** |
| `app/admin/[id]/page.tsx:57` | `status IN PAID` |
| `app/api/export/orders/route.ts:14` | `status != "pending"` → CSV with a per-order fee column |

**⇒ Already producing false financials.** Casa Makulay's order is
`status: "fulfilled"` (in `PAID_STATUSES`) carrying `feeCents: 50`, so admin
reports **$25.00 GMV and $0.50 of DropQ revenue that was never collected**, and
the vendor's own Payments page shows a fee they were never charged. Predates
this project.

### 1.11 Rewards — already correct, needs no change

`awardPointsForOrder` gates on `paymentStatus === "paid"` + `customerId`, sums
`OrderItem.priceCents × quantity`, writes `reason: "purchase"`, idempotent on
unique `(orderId, reason)`. `reversePointsForOrder` looks up exactly
`{orderId, reason: "purchase"}` and never throws. **Walk-up orders flow through
it unmodified** — they reach `paymentStatus: "paid"` by the same path online
orders do.

### 1.12 What already exists and should be reused

| Need | Already there |
|---|---|
| QR generation | `qrcode@1.5.4`; `QRCode.toDataURL` used server-side at `app/dashboard/drops/[id]/page.tsx:55` |
| Vendor sees payment land | `components/live-orders.tsx` polls `GET /api/drops/[id]/orders` every **5s**, seller-owned, already returns `paymentStatus` |
| Atomic single-winner claim | the `updateMany`-with-predicate pattern in `finalizePaidOrder` |
| Award-once / commission-once | unique `(orderId, reason)` · unique `(orderId, salesRepId)` |
| Guest identity | `upsertCustomer` (`lib/customer-auth.ts:102`) — email-keyed, name/phone optional |
| Acquisition attribution | `applyFirstTouch` accepts an **explicit fallback**, so no cookie is required |
| Guest → account conversion | `components/claim-order-panel.tsx`, already rendered on `/order/[id]:205` |
| Abandoned-checkout sweep | `reconcilePendingOrders()` — finalizes paid, cancels expired |
| Vendor authorization | `requireSeller()` + `order.sellerId === seller.id` |

**No new QR library, no new identity system, no new acquisition funnel, and no
second card-payment pipeline.**

---

## 2. Current state machine

```
   ONLINE CHECKOUT (Stripe)
        │
        └──▶ status=pending / paymentStatus=pending / stock UNCLAIMED
                   │                        │
     finalizePaidOrder                      │ session expired (reconcile sweep)
     (claims "pending")                     ▼
                   │            status=canceled / paymentStatus=expired
                   ▼
        ┌──────────────────────────────┐
        │ status=new, paymentStatus=paid │──▶ in_progress ──▶ ready ──▶ completed
        │ +OrderEvent(payment,paid)      │
        │ +stock claimed                 │──▶ canceled  (⚠ NO refund issued — §1.9)
        │ +DropPoints +commission +email │
        └──────────┬─────────────────────┘
                   │ oversold, same txn
                   ▼
        refund_pending ──▶ Stripe refund ──▶ refunded (+points reversed)

   ⚠ payInPerson=1  OR  vendor has no Stripe        ← BOTH TO BE REMOVED (§1.5/§1.6)
        │
        └──▶ status=new / paymentStatus=unpaid / stock claimed immediately
             terminal — nothing can ever move it to paid
```

---

## 3. Walk-up order model — the core decision

The question the brief poses: **create the Order first and then generate Stripe
Checkout, create a temporary cart and create the Order during checkout, or reuse
the pipeline some other way?**

### 3.1 Why "Order first" fails

Creating the `Order` when the *vendor* rings up the sale means creating it
before any customer has identified themselves. That collides with the schema:

- **`buyerName` and `buyerEmail` are `String`, NOT NULL.** A vendor-created
  order has neither. Making them nullable is not a small change — dozens of
  call sites do `order.buyerName.split(" ")[0]` for email and SMS copy, across
  `lib/checkout.ts`, `lib/actions/dashboard.ts`, `lib/actions/order.ts`,
  `lib/disputes.ts` and the admin pages. Sentinel empty strings are worse: they
  render as blanks in vendor UI and in emails.
- **Abandonment is routine at a market.** Every customer who wanders off leaves
  a junk `Order` row that the sweep turns into a `canceled` order, polluting the
  vendor's own order history and the canceled tab.
- It would require paying an order that is **not** `status: "pending"`, forcing
  the risky `finalizePaidOrder` refactor described in §1.4 — on the shared path
  that every online payment already depends on.

### 3.2 Why "Order created during checkout" wins

Let the vendor's cart live in a short-lived **`WalkUpSale`** row, and create the
`Order` at the moment the customer identifies themselves — immediately before
the Stripe session, in the same request.

```
Vendor picks items ──▶ WalkUpSale (token, lines, total, expiresAt)
                              │
                        QR → /pay/{token}
                              │
              Customer enters email ──▶ Order created here
                                        status=pending, paymentStatus=pending
                                        stock UNCLAIMED, buyerEmail REAL
                              │
                        Stripe Checkout ──▶ webhook ──▶ finalizePaidOrder
                                                        (UNCHANGED)
```

This gives, in order of importance:

1. **`finalizePaidOrder`, the success page and `reconcilePendingOrders` are
   untouched.** The walk-up order is byte-for-byte the same shape as an online
   order at the moment payment begins: `pending`, stock unclaimed, session
   attached. The riskiest refactor in the earlier draft disappears entirely.
2. **No schema change to `Order`'s identity columns.** `buyerEmail` is always
   real, because the Order does not exist until someone typed one.
3. **No junk orders.** An abandoned walk-up sale is an expired `WalkUpSale`
   row, invisible to the vendor's order history.
4. **Abandoned-checkout handling is free** — a walk-up order that reaches Stripe
   and is abandoned is swept by the existing `reconcilePendingOrders`.
5. **Oversell protection is free** — stock is claimed by the existing
   conditional increment at payment, with the existing auto-refund rollback.

The cost is one new model and the fact that the vendor sees a *pending sale*
rather than a *pending order* until the customer engages. That is arguably the
more honest representation of what is actually happening at the booth.

### 3.3 Schema delta — 1 model, 1 column

```prisma
/// A vendor-initiated in-person sale, awaiting a customer.
/// Deliberately NOT an Order: no customer has identified themselves yet, and
/// abandonment at a market is routine. Converts to exactly one Order when a
/// customer opens the payment link (enforced by orderId @unique).
model WalkUpSale {
  id       String @id @default(cuid())
  /// Unguessable QR/link secret — the QR is shown on a screen in public.
  token    String @unique
  sellerId String
  seller   Seller @relation(fields: [sellerId], references: [id], onDelete: Cascade)
  dropId   String
  drop     Drop   @relation(fields: [dropId], references: [id], onDelete: Cascade)

  /// Snapshot of what the vendor rang up:
  /// [{ productId, name, priceCents, quantity }]
  lines      Json
  totalCents Int

  /// open | claimed | paid | expired | canceled
  status String @default("open")

  /// Set exactly once, when a customer claims the sale. The unique constraint
  /// is the idempotency guard: two phones scanning the same QR cannot both
  /// produce an order.
  orderId String? @unique

  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([sellerId, status])
}
```

```prisma
model Order {
  // ...
  /// online | in_person   (legacy: "live", never used in production)
  source String @default("online")     // ← no schema change, already a free String
  /// When money was actually received. Null = never paid.
  paidAt DateTime?                     // ← the one new column
}
```

**Total: one new model, one nullable column.** No enum changes, no NOT NULL
changes, no renames, no `--accept-data-loss`.

`paidAt` earns its place three times over: it is the honest revenue-by-date
axis (`createdAt` is wrong for anything paid later than it was placed), the
clean reporting boundary that replaces the `status`-based filters in §1.10, and
the natural home for the payment timestamp. It is **not** needed as a
concurrency primitive — the existing `status: "pending"` claim already provides
that under this model.

`Drop.allowPayInPerson` is **not** added. It only existed to gate a
customer-facing pay-later option that is now being removed.

### 3.4 Why not reuse `source: "live"`

`source` already allows `live`, documented as "live QR / on-site POS". It has
**zero rows in production** and its meaning is *customer* self-orders at a live
drop — not a vendor-initiated sale. Redefining a value in place is worse than
adding one. Use `in_person`; treat `live` as legacy and retire it separately.

---

## 4. Payment lifecycle

| Question | Answer |
|---|---|
| **QR URL** | `https://www.drop-q.com/pay/{token}` — a DropQ page, not a raw Stripe URL. A Stripe URL baked into a QR dies with its session; a DropQ URL stays valid and can mint a session on demand. |
| **Sale validity** | `WalkUpSale.expiresAt` = **30 minutes**. The vendor is standing right there, and it bounds how long a photographed QR stays live. |
| **Session validity** | The existing **60 minutes** (`expires_at`), starting when the customer submits the pay form. |
| **Checkout Session appropriate?** | Yes — same `stripe.checkout.sessions.create` on the connected account, same `application_fee_amount`, same `metadata.orderId`, same success/cancel URLs. A reuse, not a parallel system. |
| **Two phones scan the same QR** | `WalkUpSale.orderId @unique` + a conditional `updateMany where status: "open"`. One wins; the other sees "This sale is already being paid." |
| **Customer scans, never pays** | The order sits `pending` until its session lapses, then the existing `reconcilePendingOrders` cancels it. Stock was never claimed, so nothing is held. |
| **Customer abandons before the pay form** | `WalkUpSale` expires at 30 min. No Order ever existed. |
| **Vendor starts over** | Cancels the current `WalkUpSale`; if it already produced an order with an open session, `sessions.expire()` that session first, then create a fresh sale. |
| **Vendor closes the QR screen** | Nothing happens. State is in the DB; reopening the sale resumes it. |
| **How the vendor learns it's paid** | Poll — the mechanism `components/live-orders.tsx` already uses. 3s on the focused sale panel, existing 5s on the drop feed. The webhook remains the source of truth; polling only reads DB state the webhook wrote. **No new realtime infrastructure.** |
| **Customer confirmation** | Existing `/order/{id}` success page, unchanged, including the claim-your-account panel. |
| **DropPoints** | Existing `awardPointsForOrder` via the unchanged finalize path. |
| **Fees** | Normal `calcFeeCents`, normal `application_fee_amount`. DropQ earns its fee exactly as online. |
| **Refunds** | Normal Stripe refunds — it *is* an ordinary Stripe charge. |
| **Oversell** | Existing conditional increment + auto-refund, unchanged. |

**The Order is never created outside a customer request.** Payment never
produces an order that did not already exist, which is what keeps the webhook
path — and therefore every online payment — untouched.

---

## 5. Customer identity — the acquisition design

The goal: a walk-up buyer should leave as a DropQ customer, not an anonymous
Stripe charge. The constraint: no meaningful friction before payment.

### 5.1 Considered and rejected — let Stripe collect the email

Stripe Checkout always collects an email, exposed as
`session.customer_details.email`. We could create the Order with no identity and
backfill from the webhook — **zero** DropQ-side fields.

Rejected, for three reasons:

- The customer would go straight from a QR to a page branded as **the vendor**
  (direct charges — the statement descriptor and Checkout branding are the
  vendor's). DropQ would be invisible in the exact moment it is trying to
  acquire someone.
- SMS consent cannot be captured on Stripe's page. Under the A2P remediation,
  consent must be explicit, unbundled and versioned (`lib/sms-consent.ts`) —
  there is nowhere to put that disclosure.
- It reintroduces the §3.1 problem: an Order with no `buyerEmail` at creation.

### 5.2 Recommended — one required field

A DropQ-hosted, vendor-branded page at `/pay/{token}`:

```
┌────────────────────────────────────────┐
│  [logo]  Casa Makulay                  │
│                                        │
│  1× Frog Incense Holder        $25.00  │
│  ─────────────────────────────────────  │
│  Total                         $25.00  │
│                                        │
│  Email  [_____________________]  ← required (receipt)
│  Name   [_____________________]  ← optional
│  Phone  [_____________________]  ← optional
│  [ ] Text me order updates       ← existing A2P disclosure, unchecked
│                                        │
│  [        Pay $25.00        ]          │
│  🔒 Secure checkout powered by Stripe  │
└────────────────────────────────────────┘
```

**One required field.** That is not excessive friction — it is the receipt
address, which the customer needs anyway, and it is fewer fields than the
existing online checkout.

On submit, in one request: `upsertCustomer` → create `Order`
(`source: "in_person"`, `status: "pending"`, `paymentStatus: "pending"`) →
`applyFirstTouch` → create Checkout Session → redirect. Guest checkout, no
password, no account.

### 5.3 Everything after payment is already built

| Acquisition outcome | Mechanism | New work |
|---|---|---|
| Customer record | `upsertCustomer` (email-keyed) | none |
| Purchase history | `Order.customerId` → `/my/orders` | none |
| DropPoints | `awardPointsForOrder` | none |
| Vendor relationship | `recordRelationship` → `CustomerVendor` | move to payment time (§1.7) |
| Acquisition attribution | `applyFirstTouch(customerId, { vendorId, dropId, source: "in_person", detail: slug })` — it accepts an **explicit fallback**, so the middleware touch cookie is not needed | pass `"in_person"` |
| Account creation | `ClaimOrderPanel`, already on `/order/[id]:205` | none |
| Discover future drops | post-order discovery CTA, already on `/order/[id]` | none |

`signupSource: "in_person"` becomes a first-class acquisition channel in the
Phase 1 attribution model at no cost — and a genuinely interesting one, since it
identifies customers DropQ acquired *for* a vendor at a physical event.

A returning customer who already has an account is simply matched by email; if
they are signed in on their phone, the order links to them directly.

---

## 6. Vendor experience

Entry point: **New In-Person Sale** on `/dashboard/drops/[id]`, beside the
existing share/QR block and the live-orders feed. Scoping the sale to a drop is
required, not incidental — `Order.dropId` is NOT NULL, `OrderItem` references
`Product`, and `Product` belongs to a `Drop`. The drop also supplies fulfillment
and pickup context for the receipt.

*(Ad-hoc items not on a drop would need the `VendorProduct` library and a
nullable `dropId`. Explicitly out of scope.)*

**Step 1 — ring it up**

```
New in-person sale · Frog Incense Holder drop

  Frog Incense Holder   $25.00     [ − ] 1 [ + ]     4 left
  Sticker pack           $5.00     [ − ] 0 [ + ]    22 left

  Total                 $25.00
  [ Cancel ]                    [ Show QR → ]
```

**Step 2 — customer pays on their phone**

```
┌────────────────────────────────────┐
│  Customer pays on their phone      │
│  $25.00 · 1 item                   │
│                                    │
│        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              │
│        ▓▓ QR CODE  ▓▓              │
│        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              │
│                                    │
│  drop-q.com/pay/xxxx               │
│  [ Copy link ]   [ Text it ]       │
│                                    │
│  ⏳ Waiting for the customer…       │  ← polls 3s
│     Expires in 29:41               │
│                                    │
│  [ Cancel sale ]                   │
└────────────────────────────────────┘
```

The panel advances through **Waiting → Customer is paying… → ✓ Paid $25.00**,
then the sale becomes an ordinary order in the live feed and follows the normal
fulfillment flow. Taking cash is simply *not using DropQ* — there is no button
for it, by design.

**Eligibility** is a single centralized predicate (fixing §1.8), and it enforces
governing principle 1 — **a vendor who is not charge-ready cannot start a
walk-up sale**, exactly as they cannot take an online order:

```ts
// lib/payments.ts
canStartInPersonSale(seller, drop): { ok: true } | { ok: false; reason: string }
//   isStripeEnabled() && seller.stripeChargesEnabled
//   && seller.stripeAccountId && !seller.disabledAt
//   && drop.sellerId === seller.id
//   && drop has at least one in-stock product
```

There is deliberately **no cash fallback** in this flow. A vendor whose Stripe
is not charge-ready at a market cannot ring up a DropQ sale at all — they take
cash outside DropQ, which is the settled model, and DropQ records nothing.

Deliberately **not** required: drop `live`, or inside its ordering window. The
vendor is physically selling right now; the customer-facing ordering window
governs customers, not the vendor at their own booth.

A vendor without Stripe sees the button disabled with
*"Connect Stripe to take in-person payments"* → `/dashboard/payments`.

---

## 7. Race conditions and idempotency

Every guard is either an existing mechanism or a database constraint.

| # | Scenario | Guard | Outcome |
|---|---|---|---|
| 1 | Two phones scan the same QR | `updateMany where { token, status: "open" }` + `orderId @unique` | one order; the other phone is told the sale is in progress |
| 2 | Customer double-taps **Pay** | same claim; if the sale already has an order with an `open` session, redirect to that session | one order, one session, one charge |
| 3 | Stripe webhook retried | existing `status: "pending"` claim in `finalizePaidOrder` | one points row, one commission row, one email |
| 4 | Webhook and success page race | existing claim — already proven in production | exactly one finalize |
| 5 | Vendor cancels while the customer is paying | cancel refuses once `WalkUpSale.status = "claimed"` and the session is open; vendor is told to wait or refund after | never a charge with no order |
| 6 | Vendor "starts over" with an open session | `sessions.expire()` the old session **before** creating the new sale | only one chargeable link exists at a time |
| 7 | Two vendor devices open the same sale | both render the same token and the same QR — idempotent by construction | no duplicate sales |
| 8 | Last unit sold online mid-scan | existing conditional `sold + qty <= inventory` increment + auto-refund | inventory never negative; buyer refunded and notified |
| 9 | Sale expires while the customer types | Order creation re-checks `expiresAt` inside the claim | clear "this sale expired, ask the vendor to restart" |
| 10 | Points awarded twice | existing unique `(orderId, "purchase")` | impossible |

**No scenario can** double-charge, double-award, create duplicate orders,
produce a charge without an order, or overwrite payment history. The
single-winner primitive is the same conditional-`updateMany` pattern already
trusted by `finalizePaidOrder`, applied one layer earlier.

Because cash is out of scope, the hardest class of race from the previous draft
— a Stripe payment colliding with a manual cash attestation — **cannot occur**.

---

## 8. Refunds, cancellation, fulfillment, reporting

### 8.1 Refunds — one path, Stripe

Every DropQ order is a Stripe charge, so there is exactly one refund mechanism:

```ts
stripe.refunds.create(
  { payment_intent, refund_application_fee: true },
  { stripeAccount, idempotencyKey: `refund-${order.id}` }
);
```

Identical for online and in-person. `refund_application_fee: true` is
non-negotiable — without it DropQ keeps its fee while the vendor eats the loss
(the bug fixed in session 2). `refund_pending` → `refunded`, points reversed via
the unchanged `reversePointsForOrder`, commission voided via the unchanged
`voidCommissionForOrder`.

**A vendor-initiated refund does not exist yet (§1.9) and must be built.** No
external-refund state, no attestation, no new payment method — that whole branch
of the earlier design is gone.

### 8.2 Cancellation

Unchanged and independent of refund. Canceling a **paid** order prompts the
vendor to refund and must not do so silently. Canceling an **unpaid** order (a
`pending` walk-up sale, say) moves no money.

### 8.3 Fulfillment

Payment and fulfillment stay orthogonal. A paid in-person order enters the
normal `new → in_progress → ready → completed` flow — often completed
immediately, since the customer is holding the item.

`updateOrderStatusAction` must continue not to touch `paymentStatus`, `paidAt`
or `source`. It doesn't today; that must stay true.

Under the new model **unpaid orders stop being created**, so the
"fulfilled + unpaid" combination becomes historical only. The legacy `fulfilled`
status stays readable (`PAID_STATUSES`, `orderStatusLabel`) and unwritable
(`ORDER_STATUSES` excludes it). No cleanup needed.

### 8.4 Reporting

Add `lib/reporting.ts` with canonical predicates and point every surface at it:

| Metric | Definition |
|---|---|
| Vendor gross sales / DropQ GMV | `SUM(totalCents) WHERE paidAt IS NOT NULL AND refunded = false` |
| **Online sales** | `... AND source = 'online'` |
| **In-person sales** | `... AND source = 'in_person'` |
| Stripe processed volume | equals GMV — every order is Stripe |
| DropQ fee revenue | `SUM(feeCents) WHERE paidAt IS NOT NULL AND refunded = false` |

Refunds subtract from gross, GMV and fee revenue alike (`refund_application_fee`
genuinely returns the fee, so the reduction is real money, not an adjustment).

There is no "external" category and no $0-fee carve-out — every DropQ order
earns the normal fee, which is the entire point of routing cards through DropQ.

**Switching from `status` to `paidAt` also fixes the live over-reporting in
§1.10**: Casa Makulay drops out of GMV and out of DropQ revenue, correctly.

---

## 9. Existing production data

9 orders, 8 sellers, 9 drops. Read-only.

| Order | Status | Payment | Session | PI | Events | Vendor | Amount |
|---|---|---|---|---|---|---|---|
| `…8oqqwo0n` | **fulfilled** | **unpaid** | — | — | **0** | Casa Makulay | $25.00 |
| `…fg8ye94o` | completed | paid | ✔ | ✔ | 4 | Paraiso | $12.24 |
| `…jeu09oiw` | completed | paid | ✔ | ✔ | 4 | Paraiso | $24.48 |
| `…ifetgc1u` | completed | paid | ✔ | ✔ | 4 | Paraiso | $8.16 |
| `…yoagxjo5` | new | paid | ✔ | ✔ | 2 | The Clovery | $5.00 |
| `…i7mrro3w` | new | paid | ✔ | ✔ | 2 | The Clovery | $13.50 |
| `…tir0v209` | new | paid | ✔ | ✔ | 2 | The Clovery | $13.50 |
| `…5hl9kxro` | new | paid | ✔ | ✔ | 2 | The Clovery | $13.50 |
| `…fahrg135` | new | paid | ✔ | ✔ | 2 | The Clovery | $24.50 |

**Zero** canceled · **zero** refunded · **zero** pending · **zero**
`source: "live"` · **zero** live-mode drops, ever. All 9 orders are
`source: "online"`.

**Vendors:** 4 with Stripe charges enabled (Britts Bunnies, Casa Makulay,
Paraiso, The Clovery); **4 with no Stripe account and zero orders** (Elias test,
DropQ Admin, Marble & Crumb, California Vintage Sales) — so closing the §1.6
hole affects no real data.

### The Casa Makulay order

`status: fulfilled`, `paymentStatus: unpaid`, `source: online`,
`totalCents: 2500`, `feeCents: 50`, no session, no PaymentIntent, 0 OrderEvents,
`customerId` linked, drop `preorder/closed`, created 2026-06-19. The vendor
**has** Stripe (`acct_1TldlAJYe7OtAQDX`, charges enabled), so the order predates
their connection.

Under this model it needs **no migration and no action**. `paidAt` stays NULL,
so it correctly leaves GMV and fee revenue (fixing today's over-report) while
remaining intact and fulfillable. It is not modified. See §10 for the one small
decision it raises.

### Data migration required: exactly one

Adding `paidAt` without backfilling it would zero every report, since all 8
genuinely-paid orders would look unpaid. Derivable and idempotent:

```sql
-- 8 rows. Idempotent; re-running updates 0. Casa Makulay excluded by the predicate.
UPDATE "Order" o SET "paidAt" = COALESCE(
    (SELECT MIN(e."createdAt") FROM "OrderEvent" e
      WHERE e."orderId" = o.id AND e.type = 'payment' AND e.detail = 'paid'),
    o."createdAt")
WHERE o."paymentStatus" = 'paid' AND o."paidAt" IS NULL;
```

No other cleanup required.

---

## 10. Settled decisions

Both open questions were decided on 2026-08-14. Nothing in this document is
awaiting input.

1. **The Casa Makulay order is left untouched — no migration, no modification.**
   Once reporting uses `paidAt` as the payment boundary (Phase G), it naturally
   stops counting as paid revenue: `paidAt` stays NULL, so it leaves GMV, vendor
   gross sales and DropQ fee revenue on its own, with no data rewrite. It
   remains in the vendor's order list as a genuine historical record of a sale
   settled outside DropQ before DropQ could take payment. **Do not cancel it,
   do not backfill it, do not fabricate a payment for it.**

   The §9 `paidAt` backfill excludes it by predicate
   (`WHERE paymentStatus = 'paid'`), which must stay true.

2. **In-person card sales earn sales-rep commission exactly as online Stripe
   sales do.** No special case, no separate rate, no exclusion. Both are DropQ
   Stripe transactions on which DropQ earns its normal fee, so the standard base
   (vendor take = gross − DropQ fee, `lib/commission.ts:39`) applies unchanged.
   `createCommissionForOrder` already runs from the shared `finalizePaidOrder`
   path, so this requires **no code**: walk-up orders inherit it by construction.

   The corollary worth stating, because it is a test assertion in Phase E: an
   in-person order that reaches `paid` must produce **exactly one**
   `CommissionLedger` row, guarded by the existing unique
   `(orderId, salesRepId)`.

---

## 11. State transition table

**Payment axis.** `status` moves independently throughout.

| From | Event | To | Allowed |
|---|---|---|---|
| — | vendor starts sale | *(no Order yet — `WalkUpSale.open`)* | ✅ |
| — | customer submits pay form | `pending` (`status: pending`) | ✅ Order created here |
| `pending` | Stripe confirms | `paid` + `paidAt` | ✅ |
| `pending` | session expires | `expired` + `status: canceled` | ✅ existing sweep |
| `pending` | vendor cancels sale | `status: canceled` | ✅ only while unpaid |
| `paid` | second payment claim | — | ❌ `status` no longer `pending` |
| `paid` | Stripe refund | `refund_pending` → `refunded` | ✅ points reversed |
| `paid` | "mark paid externally" | — | ❌ **does not exist** |
| `refunded` | any payment action | — | ❌ terminal |
| `unpaid` (legacy rows only) | any payment action | — | ❌ no path; historical |

**`WalkUpSale` axis**

| From | Event | To | Allowed |
|---|---|---|---|
| `open` | customer claims | `claimed` + `orderId` set | ✅ once only (`@unique`) |
| `open` | 30 min elapse | `expired` | ✅ |
| `open` | vendor cancels | `canceled` | ✅ |
| `claimed` | order paid | `paid` | ✅ |
| `claimed` | second claim | — | ❌ `orderId @unique` |
| `claimed` | vendor cancels | `canceled` | ⚠️ only after expiring the Stripe session |
| `paid` / `expired` / `canceled` | anything | — | ❌ terminal |

**Fulfillment axis** — `updateOrderStatusAction`, unchanged, never writes
payment fields.

| From | To | Allowed |
|---|---|---|
| `new` | `in_progress` / `ready` / `completed` | ✅ |
| any | `canceled` | ✅ (if paid, prompt to refund; never auto-refund) |
| `canceled` | anything | ❌ terminal |
| `fulfilled` (legacy) | — | read-only |

**Cross-axis invariants** *(each should have a test)*

- `paidAt IS NOT NULL` ⟺ `paymentStatus ∈ {paid, refund_pending, refunded}`
- `paidAt IS NOT NULL` ⟹ `stripePaymentIntentId IS NOT NULL` *(for all new orders)*
- `source = 'in_person'` ⟹ the order was created by a customer request at `/pay/{token}`
- every `Order` has a real, non-empty `buyerEmail`
- `WalkUpSale.orderId` is written exactly once and never cleared
- `status` transitions never write `paymentStatus`, `paidAt` or `source`
- **no code path creates an `Order` with `paymentStatus: "unpaid"`**

---

## 12. Implementation plan

Seven phases, **approved 2026-08-14**. Each is independently shippable and
independently revertible. Migration always lands **before** the code that reads
it — the Phase 7 outage came from breaking that rule, and `main` auto-deploys.

Each phase needs its own detailed plan and its own approval before any code is
written. Phase A's detailed plan is §14.

---

### Phase A — Enforce "Stripe required to sell" *(plan item 1)*

Ships first and alone. It makes governing principle 1 real: today it is stated
in a dashboard banner and enforced nowhere (§1.6). Valuable whether or not the
rest of this project proceeds.

**Changes** — four enforcement points and one copy fix:
1. Remove the customer-facing `payInPerson` option entirely (client + server).
2. **Block checkout** when the vendor is not charge-ready — the demo branch is
   restricted to a platform with no `STRIPE_SECRET_KEY`.
3. **Block publishing a drop live** when the vendor is not charge-ready, in all
   three `Drop.status` writers.
4. **Block the storefront checkout UI** so a customer is never shown a payment
   form that cannot complete.
5. Strengthen the vendor banner and put it where selling happens; distinguish
   *never connected* from *charges revoked*.
6. Fix `paymentLabel()`: `unpaid` → **"Unpaid"** (not "Pay in person"); add
   `refunded`, `refund_pending`, `expired`.

**DB** none.
**Risk** Low. Customer-facing checkout changes, so it deploys alone — but no
drop is currently live in production, so nothing is live to break.
**Tests** §14.5 — 20 assertions.
**Prod** §14.6. All 4 not-charge-ready vendors have zero orders and zero live
drops, so no customer, vendor or order is affected.

Full detail: **§14**.

---

### Phase B — Schema *(plan items 2, 10)*

**Changes** `WalkUpSale` model + `Order.paidAt`, plus the §9 backfill in the
same migration.
**DB** One new table, one nullable column, an 8-row idempotent backfill. No
`--accept-data-loss`.
**Risk** Very low — no code reads either yet.
**Tests** `migrate diff` empty after apply. All 8 paid orders have `paidAt`;
Casa Makulay does not. Re-running the backfill updates 0 rows. `Order`,
`OrderItem`, `Customer` and `Seller` verified untouched **by content hash**, per
the §5d backfill practice.
**Prod** `migrate status` clean, drift check empty, site unchanged.

---

### Phase C — Shared helpers, unused *(plan items 5, 10, 11)*

**Changes**
- `lib/payments.ts` — `canStartInPersonSale()` (§6), and a shared
  `createCheckoutSessionForOrder()` extracted verbatim from
  `lib/actions/order.ts:169-217` so online and in-person cannot drift.
- `lib/reporting.ts` — the §8.4 predicates.
- **`finalizePaidOrder` is deliberately not modified.** Add a regression test
  asserting the `status: "pending"` claim and the stock-claim invariant (§1.4),
  so a future change cannot silently break the property this design depends on.

**DB** none. **Risk** none — nothing calls the new code.
**Tests** Unit-test `canStartInPersonSale` across: no Stripe, charges disabled,
suspended vendor, foreign drop, out-of-stock drop, closed drop (**allowed**),
happy path. Reporting predicates run against production data and reproduce
today's numbers **except** Casa Makulay leaving GMV and fee revenue — the
intended correction.
**Prod** No observable change.

---

### Phase D — Walk-up sale creation + vendor UI *(plan items 2, 3, 4)*

**Changes** `startInPersonSaleAction` (`requireSeller()` + ownership +
`canStartInPersonSale` + server-recomputed prices from `Product`, never the
form) → `WalkUpSale`. Vendor item-picker and QR panel on
`/dashboard/drops/[id]` reusing `QRCode.toDataURL`. `GET /api/walkup/[id]/status`
for the 3s poll, seller-owned. Cancel/start-over.

**DB** writes `WalkUpSale` only. **No `Order` is created in this phase**, so no
payment code is reachable.
**Risk** Low — the sale is inert until Phase E ships the pay page.
**Tests** Prices always come from `Product`, never the request. Cross-vendor
drop rejected. Unauthenticated rejected. Expiry honoured. Cancel works.
Scenario 7 (two vendor devices) renders the same token.
**Prod** Create and cancel a real sale; confirm the QR renders and no order
appears anywhere.

---

### Phase E — Customer pay page *(plan items 4, 5, 6, 7, 8)*

The load-bearing phase.

**Changes** `/pay/{token}`: vendor-branded summary, email required, name/phone
optional, existing A2P consent checkbox. On submit, one server action:
claim the sale (`updateMany where { token, status: "open" }`) → `upsertCustomer`
→ create `Order` (`source: "in_person"`, `status: "pending"`,
`paymentStatus: "pending"`, real `buyerEmail`) → `applyFirstTouch(..., source:
"in_person")` → `createCheckoutSessionForOrder()` → redirect.
Set `paidAt` inside the existing finalize claim.

**Also in this phase — move `recordRelationship({ purchase })` from order
creation to `finalizePaidOrder`** (§1.7), for **both** flows. Abandoned
checkouts must stop counting as purchases, and walk-up abandonment makes that
urgent rather than cosmetic.

**DB** writes `Order`, `OrderItem`, `Customer`, `CustomerVendor`, `WalkUpSale`.
**Risk** **Highest in the project** — real charges, and it touches
`finalizePaidOrder` for `paidAt` and the relationship move. Mitigated by the
Phase C regression test and by online checkout being unchanged in shape.
**Tests**
- End-to-end walk-up payment: order `paid`, exactly one points row, one
  commission row, one confirmation email, stock claimed once.
- Scenarios 1, 2, 5, 6, 9 from §7, each explicitly.
- Webhook replayed 3× → no change (scenario 3). Webhook/success-page race →
  one finalize (scenario 4).
- Abandoned after Stripe → `reconcilePendingOrders` cancels it, stock never
  claimed.
- Oversell mid-scan → auto-refund fires and the buyer is notified.
- Amount/price tampering in the pay-form request is ignored.
- Existing online checkout regression: unchanged behaviour, and abandoned online
  checkouts no longer increment `CustomerVendor.orderCount`.
- Identity: new email → `Customer` created, `signupSource: "in_person"`,
  `CustomerVendor` created **on payment**; existing email → matched, no
  duplicate; `ClaimOrderPanel` renders on the success page.

**Prod** One real **$1.00** walk-up sale on a test vendor, paid on a phone.
Verify: order paid, DropPoints awarded once, `CustomerVendor` created, receipt
received, order visible in `/my/orders`, claim panel present.

---

### Phase F — Refunds *(plan item 9)*

**Changes** Vendor-initiated Stripe refund action — **new; none exists** (§1.9)
— with `refund_application_fee: true` and an idempotency key. Refund prompt when
canceling a paid order. Method-aware copy.

**DB** writes `paymentStatus`, and `paidAt` is never cleared.
**Risk** Medium-high — moves real money, and it is greenfield.
**Tests** Double-submit refunds once. Points reversed exactly once. Commission
voided. Partial-refund behaviour explicitly decided (recommend full-only for
now). Refunding an in-person order behaves identically to an online one.
**Prod** Refund the Phase E $1.00 payment; verify in Stripe, in the ledger and
in both reporting categories.

---

### Phase G — Reporting cutover *(plan item 10)*

**Changes** Point `app/dashboard/payments`, `app/dashboard/analytics`,
`app/admin`, `app/admin/[id]` and the CSV export at `lib/reporting.ts`. Add the
online-vs-in-person split. Add `source` to the CSV export.
**DB** none.
**Risk** Medium — every reported number changes. The §1.10 correction is
intentional and should be announced, not discovered.
**Tests** Each metric reconciled by hand against the 9 production orders before
and after. The only delta is Casa Makulay's $25.00 leaving GMV and $0.50 leaving
DropQ revenue, plus any Phase E/F test orders.
**Prod** Screenshot every reporting surface before and after; confirm each delta
is explained.

---

### Sequencing

```
A ──▶ B ──▶ C ──▶ D ──▶ E ──▶ F ──▶ G
│                        │
└ security, ships now    └ first real charges
```

Strictly sequential. **Phase A can ship immediately and independently** — it is
a security fix that stands on its own. B/C are inert groundwork. E is the gate:
nothing after it should start until a real walk-up payment has been verified in
production.

### Rollout

Behind a per-vendor gate, not a global flag: **New In-Person Sale renders only
for charge-ready vendors** (`canStartInPersonSale`), which is already the
correct product rule and is self-limiting — half the current vendor base cannot
see it. Pilot with one real vendor at one real market before announcing it.

---

## 13. Pre-existing defects surfaced by this review

Found while investigating; none introduced by this project.

| # | Defect | Severity | Where | Fixed in |
|---|---|---|---|---|
| 1 | `payInPerson=1` accepted without checking `drop.mode` — free orders | 🔴 security | `lib/actions/order.ts:89` | A |
| 2 | Vendors without Stripe silently take free, inventory-consuming orders via the "demo mode" branch | 🔴 security | `lib/actions/order.ts:222` | A |
| 2b | **Charge capability revoked mid-drop** (`account.updated`) silently converts a live storefront into a free-order storefront, with no vendor alert | 🔴 security | `app/api/stripe/webhook/route.ts:126` | A |
| 2c | A drop can be published **live** with no Stripe connected — none of the three `Drop.status` writers check | 🔴 security | `lib/actions/dashboard.ts:341,428,527` | A |
| 2d | `updateDropStatusAction` writes `Drop.status` straight from the form with no whitelist, unlike its two siblings | 🟠 | `lib/actions/dashboard.ts:527` | A |
| 3 | Unpaid orders counted in GMV **and DropQ fee revenue** | 🔴 financial reporting | `app/admin/page.tsx:70` +4 | G |
| 4 | `CustomerVendor.orderCount` / `totalSpentCents` / `firstPurchaseAt` incremented at checkout, not payment | 🟠 data quality | `lib/actions/order.ts:131` | E |
| 5 | No vendor-initiated refund exists; canceling a paid order keeps the customer's money | 🟠 | codebase-wide | F |
| 6 | `paymentLabel("unpaid")` renders **"Pay in person"** | 🟠 misleading copy | `lib/orders.ts:45` | A |
| 7 | `refunded` / `refund_pending` / `expired` render as raw strings | 🟡 cosmetic | `lib/orders.ts:45` | A |
| 8 | `paymentsEnabled` computed independently in two files | 🟡 drift risk | `app/s/[slug]/[dropId]/page.tsx:94`, `lib/actions/order.ts:92` | C |

---


## 14. Phase A — detailed plan (awaiting approval)

**Goal: make governing principle 1 enforceable.**

> **All active DropQ vendors must be Stripe-enabled.**
> A vendor who is not connected and charge-ready cannot sell — not online, not
> walk-up, not at all. There is no fallback that creates a real order without a
> real payment.

Phase A ships alone. It adds no schema, no migration and no dependency. It is
worth shipping even if the rest of this project never happens, because today the
rule is *stated* in the vendor dashboard (`app/dashboard/page.tsx:112`) and
*enforced* nowhere.

### 14.1 How a free order happens today

Three gaps compound, in the order a vendor hits them.

**(a) Publishing.** `Drop.status` is written by `createDropAction:341`,
`updateDropFullAction:428` and `updateDropStatusAction:527`. **None checks
Stripe.** A vendor who never connected can publish a live drop and get a public
storefront with a working-looking checkout.

**(b) Checkout.** Everything funnels through one decision at
`lib/actions/order.ts:91-96`:

```ts
const stripe = getStripe();                        // null only if no platform key
const useStripe =
  !!stripe &&
  drop.seller.stripeChargesEnabled &&
  !!drop.seller.stripeAccountId &&
  !payInPerson;                                    // ← bypass #1
```

True → the Stripe branch (`:141-220`): order `status: "pending"`, stock
**unclaimed**, Checkout Session, redirect to Stripe.

False → falls through to `:222-292`, labelled:

```ts
// ----- Demo mode (no Stripe configured): finalize immediately -----
```

which claims stock atomically, creates the order `status: "new"`,
`paymentStatus: "unpaid"`, and sends a full "Got your order! 🎉" email and SMS.
A completed, fulfillable order for which no money was ever requested.

Two independent ways in:

- **Bypass #1 — `payInPerson`.** `:89` reads the field; nothing validates it.
  The UI renders the button only when `live && paymentsEnabled`
  (`components/storefront-order.tsx:408-412`), carrying the field via `{...extra}`
  at `:43`. But the server never checks `drop.mode`, `drop.status`, or vendor
  opt-in. **Any POST containing `payInPerson=1` takes the free branch.**
- **Bypass #2 — not charge-ready.** Even with `payInPerson` deleted, `useStripe`
  is false whenever `stripeChargesEnabled` is false or `stripeAccountId` is null.
  The "no Stripe configured" comment means the *platform*; in production the key
  **is** set, so this fires only for vendors.

**(c) Mid-drop revocation.** `account.updated`
(`app/api/stripe/webhook/route.ts:126-132`) writes
`stripeChargesEnabled: !!account.charges_enabled`. Stripe disables charges
routinely — unverified identity, expired document, risk review. A vendor with a
**live drop and real customers** flips to not-charge-ready and their storefront
starts taking free orders immediately, with no alert and no visible change to
the customer. **This is the case that matters most in practice**, and it is not
an onboarding problem — it can hit the most established vendor on the platform,
mid-market.

Deleting bypass #1 alone leaves (b) and (c) wide open — the same outcome, one
line further down the same function.

### 14.2 Exact changes

**1. `components/storefront-order.tsx` — remove the customer-facing option**

| Line | Change |
|---|---|
| `30` | drop `payInPerson = false` from `SubmitBtn`'s destructured props |
| `38` | drop `payInPerson?: boolean` from `SubmitBtn`'s prop type |
| `43` | delete `const extra = payInPerson ? { name: "payInPerson", value: "1" } : {}` |
| `~50`, `~62` | remove the two `{...extra}` spreads on the `<button>` elements |
| `408-413` | delete the `live && paymentsEnabled` two-button branch; always render the single `SubmitBtn` |
| `414-419` | label becomes `"Continue to payment"` / `"Redirecting…"`; the `paymentsEnabled ? … : live ? …` ternaries lose their other arms |
| `420-430` | footer copy reduces to `"🔒 Secure checkout powered by Stripe."`; delete the "pay in person" and "Demo checkout" strings |
| `93`, `99` | the `live` prop becomes unused — remove it and its pass-through at `app/s/[slug]/[dropId]/page.tsx:209` |

`placeOrderAction` has exactly **one** caller (`:106`), so there is no other form
to update.

**2. `lib/payments.ts` (new, small) — one definition of "can this vendor sell?"**

Phase C owns the full eligibility module, but the rule is needed in four places
now, and writing it four times is how §1.8 happened. Ship the one predicate
early:

```ts
/**
 * Governing platform rule: an active DropQ vendor must be Stripe charge-ready.
 * Not a payment *option* — a vendor who fails this cannot sell at all.
 * `isStripeEnabled()` false means the platform has no key (local dev), which is
 * the only situation where the demo path is legitimate.
 */
export function isVendorSellable(seller: {
  stripeChargesEnabled: boolean;
  stripeAccountId: string | null;
  disabledAt: Date | null;
}): boolean {
  if (!isStripeEnabled()) return true;             // local dev only
  return !seller.disabledAt
    && seller.stripeChargesEnabled
    && !!seller.stripeAccountId;
}
```

Phase C extends this file with `canStartInPersonSale()`, which will call it.

**3. `lib/actions/order.ts` — block checkout**

| Line | Change |
|---|---|
| `89` | delete the `payInPerson` read |
| `92-96` | `useStripe` becomes `!!stripe && drop.seller.stripeChargesEnabled && !!drop.seller.stripeAccountId` |
| after `65` | **new guard**, with the other validation, before any write |
| `222` | retitle `// ----- Local dev only: no platform Stripe key -----`, and state in the comment that it is unreachable in production |

```ts
// Platform rule: DropQ vendors sell through Stripe or not at all. Without this
// the branch below would create a real, free, inventory-consuming order.
if (!isVendorSellable(drop.seller)) {
  return { error: "This store isn't accepting orders right now." };
}
```

Placed **after** the existing `disabledAt` and `isDemoStore` checks and
**before** the line-item loop, so nothing is written and no stock is touched.

**4. `lib/actions/dashboard.ts` — block publishing a drop live**

All three `Drop.status` writers gain the same gate. A vendor may still create,
edit and save drops as **drafts** — only going live is blocked, so no work is
lost while they finish Stripe.

| Function | Line | Change |
|---|---|---|
| `createDropAction` | `341` | if the requested status resolves to `live` and `!isVendorSellable(seller)`, force `status: "draft"` and redirect to the editor with `?stripe_required=1` |
| `updateDropFullAction` | `428` | same — a drop cannot transition to `live` while not sellable |
| `updateDropStatusAction` | `527` | same, **plus** whitelist the status against `["draft","live","closed"]` (defect 2d — it currently writes the raw form value) |

Going **`live → closed`** and **`live → draft`** must stay allowed regardless —
a vendor whose Stripe breaks needs to be able to close their drop.

**5. `app/s/[slug]/[dropId]/page.tsx` — never show an unpayable checkout**

`paymentsEnabled` at `:94` is replaced by `isVendorSellable(drop.seller)`. Where
`orderingOpen` is true but the vendor is not sellable, render a
"not accepting orders right now" card in place of `<StorefrontOrder>`, reusing
the styling of the existing `scheduled` / `closed` states at `:229+`, and keeping
`pickupBlock` and the `WaitlistForm` so interest is still captured.

Deliberately vendor-neutral copy — a customer should not be told their vendor's
payment account has a problem.

**6. Vendor UI — say it where selling happens**

The banner at `app/dashboard/page.tsx:112-127` already exists but is
dashboard-home only and advisory. Three changes:

- **Distinguish the two states.** `stripeAccountId == null` → *"Connect Stripe
  to start selling"* (onboarding). `stripeAccountId != null &&
  !stripeChargesEnabled` → **"⚠️ Payments are disabled on your Stripe account —
  your storefront is not accepting orders"** with a link to the Stripe
  dashboard. These are completely different situations and currently render the
  same "finish setting up" copy.
- **Escalate when it's actively costing sales.** If the vendor has any drop with
  `status: "live"` while not sellable, the banner says so explicitly.
- **Extract to a `StripeRequiredBanner` component** and render it on
  `/dashboard/drops`, `/dashboard/drops/new` and `/dashboard/drops/[id]` — the
  pages where a vendor is trying to sell — not just the home page a vendor
  mid-market never opens.

**7. `lib/orders.ts` — fix the misleading labels** (defects 6 and 7)

```ts
// :45  paymentLabel
paid            → "Paid"
unpaid          → "Unpaid"            // was "Pay in person"
pending         → "Awaiting payment"
refund_pending  → "Refund pending"    // new
refunded        → "Refunded"          // new
expired         → "Expired"           // new
// :51  paymentStyle — matching styles for the three new keys
```

Consumed by `app/dashboard/orders/page.tsx:84`, `app/my/orders/[id]/page.tsx:42`
and `components/live-orders.tsx:111` — all pick this up automatically.

**Not in Phase A:** any schema change (B), `canStartInPersonSale` (C), the
`Drop.mode === "live"` concept (untouched and still unused), and any email or
SMS alert on charge revocation (§14.8).

### 14.3 Expected behaviour for a vendor without Stripe

The state is **selling-disabled**, not a payment mode. Everything that is not
selling keeps working, so nothing they have built is lost.

| Surface | Before | After |
|---|---|---|
| Log in, dashboard, messages, customers | works | unchanged |
| Create / edit a drop, add products, upload photos | works | unchanged — **drafts are fine** |
| **Publish a drop live** | allowed | **blocked**; saved as draft, editor explains why |
| Existing live drop when Stripe breaks | keeps taking **free** orders | ordering disabled; drop can still be closed |
| Storefront `/s/{slug}` | normal | normal |
| Drop page, ordering open | full order form | **"Not accepting orders right now"**; pickup details and waitlist still shown |
| Forged checkout POST | **free order created**, stock decremented, confirmation sent | rejected; nothing written |
| Walk-up sale (future, Phase D) | n/a | blocked by `canStartInPersonSale` |
| Vendor dashboard | advisory banner on home only | state-specific banner on home **and** every drops page |
| `/dashboard/payments` | "Connect Stripe" CTA | unchanged — already the right next step |
| Existing orders, history, reporting | visible | unchanged |

The remedy is already built and signposted: connect Stripe (or resolve the
Stripe requirement) on `/dashboard/payments`. `stripeChargesEnabled` refreshes
live from Stripe on every load of that page
(`app/dashboard/payments/page.tsx:28-42`) and via the `account.updated` webhook,
so the vendor self-heals with no deploy and no admin action.

**Local dev with no `STRIPE_SECRET_KEY` is unaffected** — `isVendorSellable`
returns true, and the demo branch still works for seeding and manual testing.
The marketing showcase store is separately blocked by `isDemoStore` at `:64`, so
it never reaches either branch.

### 14.4 Production blast radius — verified, zero

Read-only queries against production:

```
drops with status = "live", anywhere:  0
```

`isOrderingOpen()` requires `status === "live"`, so **the order form is not
currently rendered on any storefront in production** and `placeOrderAction` is
unreachable today. All 9 drops are `closed` or `draft`.

The four vendors that are not charge-ready:

| Vendor | Drops | Orders | Note |
|---|---|---|---|
| Elias test | 1 (closed) | 0 | |
| DropQ Admin | 0 | 0 | |
| Marble & Crumb | 2 (closed) | 0 | `slug = marble-crumb` = **the demo showcase**, already blocked by `isDemoStore` |
| California Vintage Sales | 1 (closed) | 0 | |

Only **two** real storefronts change behaviour, both with zero open drops and
zero orders ever. No customer, no vendor and no existing order is affected. No
vendor is mid-sale, so nobody is interrupted.

### 14.5 Tests required

**Enforcement — the point of the phase**

1. POST with `payInPerson=1` against a **charge-ready** vendor's live drop →
   order created **`status: "pending"`, unpaid**, response is a Stripe redirect.
   The field is inert, not honoured.
2. Same POST against a **not-charge-ready** vendor → error returned, **zero**
   `Order` rows created, `Product.sold` unchanged.
3. Checkout against a vendor with `stripeAccountId` set but
   `stripeChargesEnabled: false` (the revocation case) → rejected.
4. Assert repo-wide that **no code path can write `paymentStatus: "unpaid"`** —
   `grep` for the literal, plus a test that the only remaining writer is the
   local-dev branch, itself unreachable when `isStripeEnabled()`.
5. Stock: a rejected order must not decrement inventory. Compare `Product.sold`
   before and after.

**Publishing gate**

6. `createDropAction` with `status: "live"` from a not-sellable vendor → drop
   created as **`draft`**, redirect carries `stripe_required=1`.
7. `updateDropFullAction` cannot move a drop `draft → live` while not sellable.
8. `updateDropStatusAction` cannot move a drop to `live` while not sellable, and
   **rejects a status not in the whitelist** (defect 2d).
9. `live → closed` and `live → draft` remain allowed while not sellable — a
   vendor must always be able to close a drop.
10. All three actions behave exactly as today for a charge-ready vendor.

**Regression — the charge-ready path must be byte-identical**

11. Full online checkout: order `pending` → session with the same
    `application_fee_amount`, `metadata.orderId`, `expires_at` and URLs →
    `finalizePaidOrder` → `paid`, one points row, one commission row, one
    confirmation email.
12. Oversell path still auto-cancels and refunds.
13. `feeMode: "pass"` still adds the "Service fee" line (Paraiso Delicacies is a
    live `pass`-mode vendor).
14. Existing validation unchanged: closed drop, outside window, suspended
    vendor, demo store, empty cart, bad email, short phone.

**UI**

15. Charge-ready + ordering open → one button, "Continue to payment", and no
    "Pay in person" anywhere in the rendered HTML.
16. Not sellable + ordering open → "Not accepting orders right now"; no order
    form; pickup block and waitlist still render; **no mention of Stripe or the
    vendor's account status**.
17. Ordering closed → unchanged for both vendor types.
18. Banner renders the **onboarding** variant when `stripeAccountId` is null and
    the **revoked** variant when the account exists but charges are off; the
    escalated variant when a live drop exists; nothing when sellable.
19. `grep -r "payInPerson"` over `app/`, `lib/`, `components/` returns nothing.

**Labels**

20. `paymentLabel("unpaid") === "Unpaid"`; the three new keys return labels;
    `paymentStyle` returns a real class for each. `/dashboard/orders` renders the
    Casa Makulay order as **"Unpaid"**, not "Pay in person".

**Existing suite**

21. `curl localhost:3000/api/dev/messaging-selftest` → **49/49 pass**. It creates
    orders directly via `prisma.order.create` (`:83`), so it should be
    unaffected — confirming that is the point.
22. `npx tsc --noEmit` clean, after
    `find .next app/generated -name "* [0-9].*" -delete`.

### 14.6 Production verification

Run after deploy. **Do not** authenticate to production from a local session —
`SESSION_SECRET` differs, so signed-in checks need a human in a browser (§5c of
the handoff).

1. `npx vercel ls drop-q --scope britt-midgettes-projects` → new deployment
   ● Ready, aliased to `www.drop-q.com`.
2. `npx prisma migrate status` → still "up to date". Phase A adds no migration;
   this confirms nothing crept in.
3. Public sweep: all 8 storefronts return 200. The two affected drop pages
   (`/s/elias-test/…`, `/s/california-vintage-resellers/…`) render without
   errors. No 500s.
4. **Order-count invariant:** `SELECT count(*) FROM "Order"` is **9** before and
   after. Phase A must create nothing.
5. **Drop-status invariant:** no drop changes `status`. Phase A blocks new
   transitions; it must not rewrite existing rows.
6. Human in a browser: sign in as a vendor, open `/dashboard/orders`, confirm the
   Casa Makulay order reads **"Unpaid"**.
7. Human in a browser, on a not-charge-ready vendor: confirm the banner shows the
   correct variant on the dashboard **and** on the drops pages, and that
   attempting to publish a drop live saves it as a draft with a clear
   explanation.
8. Because no drop is currently live, verify the charge-ready path on a **test
   vendor** with a temporary live drop and a real **$1.00** order, then refund it
   in the Stripe dashboard and close the drop. This is the only way to exercise
   checkout end-to-end without touching a real vendor's storefront.
9. Confirm the $1.00 order produced exactly one `PointsLedger` row and one
   `OrderEvent(payment, paid)`.

### 14.7 Rollback plan

Phase A is **pure application code — no schema, no migration, no data write** —
so rollback is a deploy with no state to unwind.

- **Fast path:** `npx vercel rollback` to the prior deployment, or
  `git revert <sha> && git push` (Vercel redeploys `origin/main` automatically).
  Either restores previous behaviour within one deploy cycle.
- **No data to repair.** Nothing in Phase A writes to the database, so no order,
  customer, ledger row or Stripe object can be left inconsistent by a revert.
- **Partial rollback, the likely real case.** Five independent commits (§14.9).
  If the sell gate wrongly blocks a vendor, revert the enforcement commits and
  keep the `payInPerson` removal — that still closes the more exploitable hole
  while the vendor's Stripe status is investigated.
- **Rollback triggers:** any 500 on a storefront or drop page; a charge-ready
  checkout failing to reach Stripe; a charge-ready vendor unable to publish a
  drop; `SELECT count(*) FROM "Order"` changing unexpectedly.
- **Forward-fix beats rollback for a false negative.** If a vendor is wrongly
  flagged not-charge-ready, `stripeChargesEnabled` is re-read live from Stripe on
  every `/dashboard/payments` load (`app/dashboard/payments/page.tsx:28-42`) and
  by the `account.updated` webhook — so the vendor visiting that page self-heals
  the flag with no deploy.

### 14.8 Deliberately deferred

- **Alerting a vendor when charges are revoked.** The `account.updated` webhook
  is the natural trigger, and an email would be genuinely useful — a vendor whose
  Stripe breaks overnight should not discover it from the banner. But it is new
  outbound vendor comms, and Phase A should stay an enforcement change.
  **Recommend as a small follow-up immediately after Phase A.**
- **Admin visibility of not-sellable vendors.** `app/admin` already lists
  vendors; a "selling disabled" badge is a natural addition. Not required for
  enforcement.
- **Backfilling the rule onto existing live drops.** Not needed — production has
  zero live drops. If that changes before Phase A ships, re-check §14.4.

### 14.9 Commit and deploy order

```
1. lib/payments.ts — isVendorSellable()          ← pure, unused
2. remove payInPerson (client + server)          ← no live drop exists to use it
3. checkout gate in placeOrderAction             ← the core enforcement
4. drop-publishing gate (3 actions) + whitelist  ← stops the cause upstream
5. storefront blocked state                      ← makes 3 legible to customers
6. StripeRequiredBanner + placements             ← makes 3/4 legible to vendors
7. paymentLabel / paymentStyle fixes             ← cosmetic, independent
8. push → verify §14.6 → stop
```

No migration, so the migrate-before-push rule does not apply — but the habit
does: nothing is pushed until §14.5 passes locally against the production
database in read-only mode.

---

## 15. Phase A — as shipped

Implemented, tested and deployed 2026-08-14. **No schema change, no migration,
no production data change.** 58/58 automated assertions pass
(`npm run test:phase-a`).

### 15.1 What changed

| File | Change |
|---|---|
| `lib/payments.ts` **(new)** | `isVendorSellable()`, `sellerBlockReason()`, `resolveDropStatus()`, `DROP_STATUSES`. One definition of the platform rule. |
| `components/stripe-required-banner.tsx` **(new)** | Vendor notice; distinct copy for *not connected* vs *charges disabled*; escalates when a live drop exists. |
| `scripts/phase-a-selftest.mjs` **(new)** | 58 assertions. Writes nothing. |
| `lib/actions/order.ts` | Sell gate before any write; `payInPerson` removed; free-order branch relabelled local-dev-only. |
| `lib/actions/dashboard.ts` | All three `Drop.status` writers route through `resolveDropStatus`; inline whitelist removed. |
| `components/storefront-order.tsx` | Pay-in-person button, field and prop removed; single payment path. |
| `app/s/[slug]/[dropId]/page.tsx` | Renders **"Not accepting orders right now"** instead of a checkout the vendor can't complete. |
| `app/order/[id]/page.tsx` | Stale "Pay the seller in person" replaced. |
| `app/dashboard/page.tsx` · `drops/page.tsx` · `drops/new/page.tsx` · `drops/[id]/page.tsx` | Old advisory banner replaced by `StripeRequiredBanner`; drop detail explains a `?stripe_required=1` blocked publish. |
| `lib/orders.ts` | `unpaid` → **"Unpaid"**; labels and styles added for `refund_pending`, `refunded`, `expired`. |
| `prisma/schema.prisma` | **Comment only** — the `paymentStatus` comment said "unpaid (pay in person)". Drift check confirms no schema change. |

### 15.2 Deviations from the §14 plan

Four, all found during implementation. Recorded because §14 is otherwise the
reference for what was intended.

1. **The `live` prop was NOT removed from `StorefrontOrder`.** §14.2 said it
   would be unused. It isn't — `:173-177` uses it to suppress the
   close-countdown for live-mode drops. Kept.
2. **`resolveDropStatus` lives in `lib/payments.ts`, not `lib/actions/dashboard.ts`.**
   That file is `"use server"`, where every export must be an async server
   action — a sync helper there is unexportable and therefore untestable.
   Moving it also colocates it with the rule it enforces.
3. **`app/order/[id]/page.tsx` needed fixing and §14 missed it.** It computed
   `payInPerson = paymentStatus === "unpaid" && source === "live"` and rendered
   *"Pay the seller in person."* The plan's file list didn't include it; the
   `grep` assertion caught it.
4. **The blanket "no code path may write `paymentStatus: unpaid`" assertion was
   dropped**, per explicit instruction. `unpaid` is a legitimate state — the
   Casa Makulay order holds it, and the local-dev branch writes it. The
   invariant actually enforced is narrower and truer: **a production customer
   cannot create a confirmed/reserved DropQ order without completing the Stripe
   payment flow.** Tested as "the sell gate runs before any database write"
   plus the publish gate, rather than as a grep.

### 15.3 Test results

`node --env-file=.env scripts/phase-a-selftest.mjs` → **58 passed, 0 failed**,
covering: sellability across all four vendor states; both block reasons being
distinguishable; the publish gate; **takedown always working** (`live → closed`
and `live → draft` with Stripe broken); drafts staying editable; the status
whitelist rejecting garbage, SQL-ish payloads and cross-domain values; payment
labels; and static source assertions including *the sell gate runs before any
database write*.

Also: `npx tsc --noEmit` clean · `npm run build` succeeds · `prisma migrate
diff` returns an empty migration (the schema comment edit caused no drift) ·
production build run locally against the production database renders all 8
storefronts, all 9 drop pages and the Casa Makulay order page **200 with no
errors**, and that order page now reads *"Contact Casa Makulay about payment"*.

Row counts before and after all testing: **orders 9, drops 9, orderItems 18,
pointsLedger 8, customers 8, orderEvents 22 — unchanged.** The Casa Makulay
order is byte-identical.

### 15.3a Manual production verification — publish gate ✅

Confirmed by the user in a browser on production, 2026-08-14, signed in as a
vendor with **no Stripe account**. This is the check that could not be automated
here: production's `SESSION_SECRET` differs from local, so an authenticated
vendor session cannot be minted from a local session (§5c of the handoff).

Attempting to publish a drop produced, as designed:

| Expected | Result |
|---|---|
| Drop saved as a **draft**, not live | ✅ |
| `?stripe_required=1` notice shown | ✅ |
| Entered drop data preserved | ✅ |
| **No live drop created** | ✅ |
| Vendor sees "Connect Stripe to start selling" | ✅ |

Two things this confirms beyond the gate itself:

1. **`sellerBlockReason()` picks the right variant in production.** The vendor
   saw the **`not_connected`** copy, not the `charges_disabled` copy — the
   distinction §14.2(6) exists to make, verified live rather than only in unit
   tests.
2. **The "drafts stay editable" promise is not just theoretical** — the drop
   survived the blocked publish with its contents intact, which is the whole
   point of degrading to draft rather than refusing the save.

**Still outstanding (user is verifying separately):** that the resulting draft
remains fully editable while Stripe is disconnected. Covered by automated
assertions (`draft -> draft` allowed and not flagged blocked) but not yet
confirmed in a browser.

### 15.4 Two things deliberately not verified

- **`app/api/dev/messaging-selftest` was NOT run.** Its own docstring and §5c of
  the handoff say it must not run while `.env` points at production — it creates
  sellers, drops and orders. Phase A does not touch messaging, and the route
  creates orders via `prisma.order.create`, bypassing `placeOrderAction`
  entirely, so it is unaffected by construction. **Run it on the next scratch
  database that exists.**
- **The "Not accepting orders right now" state was not rendered against real
  data.** It needs a *live* drop from a non-charge-ready vendor, and production
  has zero live drops. It is covered by type-check, build and logic assertions.
  Worth noting: after Phase A that state is only reachable when a vendor's
  Stripe breaks **after** publishing — the publish gate prevents every other
  route into it.

### 15.5 Follow-up — SHIPPED

> **When `account.updated` flips a vendor from charge-ready to not charge-ready,
> email them that selling is paused and action is required.**

Closes the last gap in §1.6(c): a vendor whose Stripe broke overnight previously
found out only from a dashboard banner they had no reason to open.

| File | Change |
|---|---|
| `lib/vendor-alerts.ts` **(new)** | `notifyVendorSellingPaused()` — looks up the vendor, counts live drops, logs an operational breadcrumb, sends the email. **Never throws.** |
| `lib/email.ts` | `sellingPausedEmail()` on the DropQ-branded `layout()` shell. |
| `app/api/stripe/webhook/route.ts` | `account.updated` now detects the *transition* rather than reacting to the event. |

**The design point that matters: fire on the transition, not the event.**
Stripe emits `account.updated` constantly — onboarding steps, document uploads,
periodic re-verification — and retries webhooks. Emailing per event would spam
vendors. The handler now uses a conditional `updateMany`:

```ts
const flipped = await prisma.seller.updateMany({
  where: { stripeAccountId: account.id, stripeChargesEnabled: !chargesEnabled },
  data:  { stripeChargesEnabled: chargesEnabled },
});
if (flipped.count > 0 && !chargesEnabled) await notifyVendorSellingPaused(account.id);
```

Only the call that actually flips the flag matches a row — the same
single-winner primitive `finalizePaidOrder` uses, one layer up. Retries and
repeat events match zero rows and stay silent.

Three deliberate choices:

- **No email when charges come back.** The storefront simply starts working and
  the banner disappears; a "you're fine now" email is noise. Easy to add later
  — the transition detector already distinguishes the direction.
- **Admin-suspended vendors are skipped.** They already can't sell and have been
  told why; a second, differently-worded pause email would confuse.
- **The alert never throws.** A webhook that 500s gets retried, but the flag is
  already flipped by then, so the retry detects no transition and the email
  would be lost anyway. Swallowing keeps the webhook 200 and keeps the failure
  in the logs.

The email states the impact precisely (`N live drops have stopped accepting
orders` vs `you won't be able to publish`), says what Stripe usually wants, and
explicitly reassures that **drops, products, orders and customers are safe,
drafts stay editable, and a live drop can still be closed** — the Phase A
guarantees, restated at the moment the vendor is most worried.

**Tests:** the 8 transition cases (lose charges, retry, repeat-while-disabled,
regain, no-op, mid-onboarding) plus 11 source assertions, inside
`npm run test:phase-a` → **77 passed, 0 failed**. `tsc` and `next build` clean.

**Not yet observed in production**, and it shouldn't be: it requires Stripe to
actually disable a live vendor's charges. The trigger is verified by test, not
by a real event. Watch for the `[stripe] charges disabled — vendor=…` log line
the first time it fires.
