# DropQ Payments v2 — Architecture Evaluation

**Status: DESIGN ONLY. No production payment code has been changed.**

The decision: DropQ wants one customer identity with saved cards that work
across vendors (destination charges). But DropQ is early-stage and should not
absorb marketplace financial exposure just to avoid customers retyping a card.
This document is the evaluation to make that call deliberately, later.

Everything in §1 was verified against the code on `845edff`.

---

## 1. Current flow and responsibility model (VERIFIED)

DropQ uses **Stripe Connect direct charges**.

```
lib/actions/order.ts   stripe.checkout.sessions.create({...},
                         { stripeAccount: drop.seller.stripeAccountId })
                       payment_intent_data.application_fee_amount = feeCents
lib/stripe.ts          calcFeeCents() = DROPQ_FEE_PERCENT (default 2) % of items
lib/checkout.ts:142    stripe.refunds.create({...}, { stripeAccount })
```

The charge is created **on the vendor's connected account**. DropQ's server
calls Stripe with the vendor's account in the header; the money never touches
DropQ's balance.

| Responsibility | Who |
|---|---|
| Merchant of record | **Vendor** |
| Stripe processing fee (~2.9% + 30¢) | **Vendor** |
| Refunds | **Vendor's** balance |
| Chargebacks + $15 dispute fee | **Vendor** |
| Negative balance risk | **Vendor** |
| Platform revenue | DropQ, via `application_fee_amount` |
| Statement descriptor | Vendor's |

**DropQ currently carries zero payment-processing financial risk.** That is the
single most important fact in this document.

### Fee mechanics

`feeCents = 2% of the items subtotal` (not the total). `Seller.feeMode`:

- `"absorb"` (default) — customer pays items; DropQ's fee comes out of the
  vendor's proceeds
- `"pass"` — customer pays items + fee as a separate "Service fee" line

Either way DropQ receives `feeCents` and the vendor bears Stripe's cut.

### ⚠️ Two findings not in the handoff

**(a) Refunds don't return the platform fee.** `stripe.refunds.create` at
`lib/checkout.ts:142` does not pass `refund_application_fee: true`. When DropQ
auto-refunds an oversold order, the customer is made whole from the *vendor's*
balance while **DropQ keeps its 2%**. The vendor is out the money and the
Stripe fee. This is a live fairness/accounting bug in the current model,
independent of v2. Low volume today, but it compounds.

**(b) No dispute visibility.** `app/api/stripe/webhook/route.ts` handles
`checkout.session.completed`, subscription events and `account.updated`. There
is **no `charge.dispute.created` handler**, so DropQ learns nothing when a
vendor is disputed. Under direct charges that's survivable — the vendor gets
Stripe's email. Under v2 it would be a serious hole, because the dispute would
be DropQ's.

---

## 2. Proposed destination-charge flow (v2)

```
Charge created on the PLATFORM account:
  stripe.paymentIntents.create({
    amount, currency: "usd",
    customer: customer.stripeCustomerId,        // ← saved cards, cross-vendor
    application_fee_amount: feeCents,
    transfer_data: { destination: seller.stripeAccountId },
    on_behalf_of: seller.stripeAccountId,       // ← see §11
  })
```

Money lands on DropQ's balance, then Stripe transfers the remainder to the
vendor. Because the charge and the `Customer` both live on the platform
account, one saved card works at every vendor — that's the whole point.

---

## 3. Who pays Stripe fees

| | Direct (today) | Destination | Destination + `on_behalf_of` |
|---|---|---|---|
| Stripe processing | Vendor | **DropQ** | Vendor *(needs confirmation — §11)* |
| Platform fee to DropQ | `application_fee` | `application_fee` | `application_fee` |
| Merchant of record | Vendor | **DropQ** | Vendor |

### 🔴 This breaks the 2% fee — the decisive number

If DropQ pays Stripe processing, on a representative **$24.00** order:

| | |
|---|---|
| DropQ platform fee (2%) | **+$0.48** |
| Stripe processing (2.9% + 30¢) | **−$0.99** |
| **DropQ net** | **−$0.51 per order** |

**Plain destination charges make DropQ lose money on every transaction at the
current 2% fee.** Break-even is roughly **4.2%** plus a fixed component. So v2
requires *either* `on_behalf_of` shifting fees back to the vendor, *or* raising
the platform fee to ~5%+, which is a repricing conversation with vendors.

---

## 4. Refund flow

**Today:** refund on the connected account; vendor's balance is debited.
DropQ's fee is *not* returned (bug (a) above).

**v2:** refund from the platform balance, with `reverse_transfer: true` to claw
the money back from the vendor and `refund_application_fee: true` to return
DropQ's cut:

```
stripe.refunds.create({ payment_intent, reverse_transfer: true,
                        refund_application_fee: true })
```

**Risk:** if the vendor's balance is already paid out and empty, the reversal
drives **the vendor** negative — and if Stripe can't recover it, DropQ absorbs
it. That risk does not exist today.

---

## 5. Chargeback / dispute flow

**Today:** the dispute is raised against the *vendor's* account. Stripe debits
the vendor, charges the vendor the $15 fee, and the vendor submits evidence.
DropQ is not a party.

**v2:** the dispute is raised against **DropQ's platform account**. Stripe
debits **DropQ's balance** for the full amount plus the **$15 dispute fee**.
DropQ must gather evidence — from a vendor who holds the fulfilment proof.

This is the exposure you're right to be cautious about.

---

## 6. Disputed after the vendor has been paid — the worst case

Sequence under v2:

1. Customer pays $500. Funds land on DropQ's platform balance.
2. Stripe transfers ~$485 to the vendor.
3. Vendor's payout hits their bank (default rolling 2 days).
4. 30 days later the customer disputes. **Stripe debits DropQ $515.**
5. DropQ calls `transfer.createReversal` — vendor's Stripe balance is $0.
6. Vendor's balance goes **negative**. Stripe attempts recovery from future
   sales. If the vendor has stopped selling, **DropQ eats the $515.**

Your instinct is exactly right: a single $5,000 disputed order would land on
DropQ, and recovery depends entirely on whether that vendor keeps trading.

---

## 7. Negative-balance exposure to DropQ

| Scenario | Today | v2 |
|---|---|---|
| Chargeback after payout | None | **Full amount + $15** |
| Refund after payout | None | Full amount |
| Vendor absconds | None | **DropQ absorbs** |
| Fraud ring | Vendor's problem | **DropQ's problem** |

Under Connect, the **platform is ultimately liable for connected-account
negative balances** — Stripe will debit DropQ's bank account.

---

## 8. Recommended payout delay / reserve strategy (only if v2 proceeds)

Do not ship v2 without these:

1. **Manual payouts** on connected accounts (`payouts.schedule.interval:
   "manual"`) so DropQ controls timing rather than Stripe's 2-day default.
2. **Hold-back window** — release a vendor's funds only after the pickup date
   plus 7 days. Most disputes for a not-delivered claim surface quickly, and
   drops have a *known* fulfilment date, which is a real advantage here.
3. **Rolling reserve** — retain 5–10% of each vendor's volume for 60–90 days,
   tapering as they build history.
4. **Per-vendor exposure cap** — block or manually review orders above a
   threshold for vendors with little history.
5. **`charge.dispute.created` webhook** — fixes gap (b) and is mandatory in v2.
6. **Radar rules** tuned for the drop pattern (bursty, high-velocity, new cards).

Items 1–3 are the difference between "manageable" and "a $5k surprise".

---

## 9. Vendor terms changes required

`app/terms/page.tsx` and `Seller.termsAcceptedAt` / `termsVersion` already
support versioned re-acceptance — v2 **must** bump the version and re-prompt.

New clauses needed:

- DropQ is merchant of record (or settlement is via the vendor under
  `on_behalf_of` — the wording depends on §11)
- Vendor is financially responsible for refunds and chargebacks on their orders
- DropQ may reverse transfers and set off against future payouts
- Payout schedule, hold-back window and reserve policy
- Vendor must supply dispute evidence within a stated window
- Negative-balance recovery, including debiting their bank account
- Who pays the $15 dispute fee

**This is a lawyer conversation, not a copy edit.**

---

## 10. Exact impact on the 2% fee

Restating §3 because it's the crux:

- **Direct (today):** DropQ nets the **full 2%**. Vendor absorbs Stripe.
- **Destination without `on_behalf_of`:** DropQ nets **2% minus ~2.9% + 30¢ →
  negative** on typical order sizes. Unworkable without repricing to ~5%+.
- **Destination with `on_behalf_of`:** DropQ nets the full 2% *if* fees shift to
  the vendor — economics unchanged, exposure still moved to DropQ.

So `on_behalf_of` isn't a nicety. Without it, **v2 requires repricing.**

---

## 11. Should `on_behalf_of` be used?

**Yes, if v2 proceeds** — but confirm the specifics with Stripe in writing first.

What it does (well documented): makes the connected account the *settlement
merchant*, so the statement descriptor, settlement country/currency and
regulatory treatment follow the vendor. Stripe fees are assessed against the
connected account.

**What I could not verify and you must confirm before relying on it:** whether
`on_behalf_of` also shifts **dispute liability** to the connected account, or
whether the platform remains liable because the charge still lives on the
platform balance. My reading of Stripe's Connect dispute docs is that with
destination charges **the platform remains responsible for disputes**, and
`on_behalf_of` does not change that — it changes settlement, not liability.

**Do not design around the assumption that `on_behalf_of` protects DropQ from
chargebacks.** Get it in writing from Stripe support. If liability doesn't
shift, the §8 reserve strategy is not optional.

---

## 12. Migration strategy that doesn't break existing orders

Non-negotiable: **never migrate in-flight orders.** A `pending` order holds a
Checkout Session on the connected account; that session must complete or expire
under the model it was created in.

Phased:

1. **Now — additive prep only, no behaviour change.** Add
   `Order.chargeModel` (`"direct" | "destination"`, default `"direct"`) so every
   historical order is self-describing. Refund and dispute code branch on the
   *order's* model, forever. `Customer.stripeCustomerId` already exists.
2. **Fix the current bugs regardless of v2** — `refund_application_fee: true`
   and the `charge.dispute.created` webhook. Both are correct under either model
   and are the cheapest risk reduction available today.
3. **Add `Seller.chargeModel`** so v2 can be enabled per vendor.
4. **Pilot** with 1–2 trusted, high-volume vendors and reserves on. New orders
   only. Existing orders keep settling as direct.
5. **Evaluate** after ~90 days — enough to see a real dispute cycle.
6. **Expand** vendor by vendor, each re-accepting updated terms.
7. **Never backfill.** Old orders stay direct-charge permanently.

This keeps `stripeAccount`-header code paths alive indefinitely for historical
orders — that is intended, not debt.

---

## Recommendation

**Stay on direct charges.** The saved-card benefit does not justify taking on
merchant-of-record status, dispute liability and negative-balance exposure at
this stage — and at 2%, plain destination charges are loss-making per order.

For Phase 5 saved cards, take **Option 1: save the card per vendor.** A repeat
customer at their regular vendor — the common case — gets one-tap checkout. The
cross-vendor case still requires re-entry, which is a mild annoyance versus an
uncapped financial liability.

Two things worth doing **now**, independent of any of this:

1. `refund_application_fee: true` — DropQ is currently keeping its fee on
   fully-refunded orders
2. `charge.dispute.created` webhook — DropQ has no dispute visibility at all

Both are small, safe, and correct under either architecture.
