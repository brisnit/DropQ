# DropQ — Internal/test activity vs. business truth

**Status: RECOMMENDATION ONLY. No schema change, no data change, nothing
implemented.**

Goal:

> We should be able to test real production commerce aggressively without
> corrupting the numbers we use to decide whether DropQ is actually working.

Verified against the repo at `ee9cde1` and the live database (read-only).

---

## 0. What production actually looks like right now

| Vendor | Reported GMV (today) | Real paid GMV | Nature |
|---|---|---|---|
| The Clovery | $70.00 | $70.00 | **real** |
| Paraiso Delicacies | $44.88 | $44.88 | **real** |
| Casa Makulay | **$25.00** | $0.00 | founder · order is `fulfilled/unpaid` |
| Britts Bunnies | $0.00 | $0.00 | founder / canary · 0 drops, 0 orders |
| **Admin total** | **$139.88** | **$114.88** | |

**The admin dashboard overstates GMV by 18% today**, before any of this is
about test accounts — $25 of it is Casa Makulay's unpaid order being counted
because the query keys on `status`, not `paymentStatus` (the §1.10 defect Phase
G fixes).

Three further contaminants, each a different problem:

1. **A dev-selftest customer leaked into production.**
   `oauth-selftest-1786676831140@example.com` ("OAuth Tester"), created
   2026-08-14 03:07. It is in the customer count.
2. **A founder is a real customer of real vendors.** `brisnit@gmail.com` paid
   **$13.50 to The Clovery** and **$8.16 to Paraiso** — genuine money, genuine
   DropQ fee. That is 2 of 9 customers and 2 of 8 paid orders.
3. **An orphaned relationship.** Britts Bunnies has 0 orders but a
   `CustomerVendor` row claiming `orderCount 1, $1.00` — the order was deleted
   with its drop (§8).

---

## 1. What counts as test data

The trap is treating this as one question. It is **three independent axes**, and
a single `isTest` flag collapses them wrongly.

| Axis | Question | Example |
|---|---|---|
| **Counterparty** | is this vendor/customer us? | Britts Bunnies, brisnit@gmail.com |
| **Economics** | did this represent market demand? | founder buying their own doughnut |
| **Reality** | did money actually move? | a real card charge in production |

A founder's $13.50 purchase from The Clovery is **counterparty-internal**,
**economically internal**, and **financially real** all at once. No single
boolean says that.

Recommended classification:

| Thing | Test when | How |
|---|---|---|
| **Vendor** | it's a DropQ-controlled store | explicit, on `Seller` |
| **Customer** | it's a founder/staff/selftest identity | explicit, on `Customer` |
| **Order** | **inherited** from either side | never flagged directly (see §3) |
| **Drop** | **inherited** from its vendor | never flagged |
| **WalkUpSale** | **inherited** from its vendor | never flagged |
| **PointsLedger / CustomerVendor** | **inherited** | never flagged |
| **Founder/admin-created activity** | inherited from the acting identity | — |
| **Stripe test-mode** | not a concern — DropQ has no test-mode path in prod | see §6 |
| **Real card, internal intent** | **financially real, economically internal** | inherited; never faked (§6) |

---

## 2. Where the designation lives

### Recommended: two nullable columns, classified at the entity, filtered by one shared module

```prisma
model Seller   { internalKind String? }   // null = real commerce
model Customer { internalKind String? }
```

Values: `founder` · `canary` · `staff` · `demo` · `selftest`. A nullable string
rather than a boolean because it costs the same and answers *why* — and because
"exclude the demo store" and "exclude our canary vendor" are different decisions
you will eventually want to make separately.

### Why both, not just Seller

**This is the non-obvious part.** Vendor-level classification alone does not
clean customer metrics. `brisnit@gmail.com` buys from *real* vendors — so the
GMV is real and belongs in The Clovery's numbers, while "active customers",
"repeat purchase rate" and eventually LTV/CAC must not count a founder. The two
axes have to be filterable independently.

### Why not the alternatives

| Approach | Why not |
|---|---|
| **`Order.isTest`** | every write path must remember to set it; reclassifying a vendor later means backfilling every row. Worth adding **later** only for the narrow case of a *real* vendor running one smoke test — not now, at 10 orders. |
| **Analytics-only exclusion list** (hard-coded ids) | drifts silently, invisible to anyone reading the DB, and can't be queried. This is what `lib/demo.ts` does today and it already only covers one store. |
| **Separate environment / DB** | the whole point is testing *real production commerce*. A staging Stripe account proves nothing about production. |
| **Derive from `isAdmin`** | `isAdmin` means "has admin access", not "is internal" — and **Casa Makulay is a founder account without `isAdmin`**. Not derivable. |

### The filtering layer matters more than the column

One module — `lib/reporting.ts`, already scoped for Phase G — exporting named
audiences rather than raw booleans, so a caller has to *choose*:

```ts
realCommerce()      // KPIs: excludes internal sellers AND internal customers
financialTruth()    // accounting: excludes nothing; every real charge counts
operational()       // queues, support, fulfilment: excludes nothing, ever
productAnalytics()  // behaviour: excludes internal customers
```

**No KPI query should ever hand-roll a `where`.** That is exactly how
`app/admin/page.tsx` ended up overstating GMV by 18%.

---

## 3. Inheritance — yes, and it should be automatic

Marking Britts Bunnies `canary` must silently exclude its Drops, Orders,
WalkUpSales, CustomerVendor rows, PointsLedger entries, GMV and conversion
events, with **no per-row marking**.

Every one of those already has a `sellerId` or `customerId`, so inheritance is a
join, not a migration:

```ts
// KPI predicate — one definition
{ seller: { internalKind: null }, customer: { is: { internalKind: null } } }
```

**Do not denormalise** an `isTest` onto child rows "for query speed". At DropQ's
volume the join is free, and a denormalised copy is one more thing that can
disagree with its parent.

The one thing inheritance *cannot* express is a real vendor running a single
smoke test. Add `Order.internalKind` **only when that actually happens**.

---

## 4. Four audiences, one dataset

Nothing is deleted or hidden. The same rows answer different questions:

| Audience | Excludes | Why |
|---|---|---|
| **Operational** — order queues, fulfilment, support, `/admin` | **nothing** | a test order still has to be fulfilled or cancelled; hiding it makes debugging impossible |
| **Financial / accounting** — Stripe reconciliation, payouts, tax | **nothing** | a real charge is real money on a real connected account regardless of who paid it |
| **Product analytics** — funnels, conversion, retention | internal **customers** | founder behaviour is not user behaviour |
| **Business KPIs** — GMV, AOV, active vendors, LTV, take rate | internal **sellers and customers** | this is the "is DropQ working" number |

Internal rows should stay **visible and labelled** in `/admin` — a small
`internal` badge — not filtered out. Seeing your canary vendor's test order is
how you confirm the smoke test worked.

---

## 5. Postgres vs PostHog

Unchanged direction: **Postgres owns business truth, PostHog owns behaviour.**
The risk is the two disagreeing about who is internal.

**Recommendation: classify once in Postgres, propagate to PostHog as a person
property.**

- At `identify()`, set `is_internal: true` (and `internal_kind`) from the
  `Customer`/`Seller` row.
- Every PostHog insight filters `is_internal is not set`. Save it as a **cohort**
  so it's one click, not a remembered step.
- **One project, not two.** A separate internal project fragments funnels,
  doubles configuration, and means a customer who later becomes internal has
  history in the wrong place.

Because the flag comes from Postgres, there is exactly one definition. PostHog
never decides who is internal.

⚠️ Current state, verified: `NEXT_PUBLIC_POSTHOG_KEY` and `_HOST` exist in all
three Vercel environments, but **no dependency, no SDK, no code reads them** —
nothing is being tracked yet. Add `is_internal` on the very first `identify()`
call rather than retrofitting it; PostHog person properties are awkward to
backfill.

---

## 6. Real Stripe charges with internal intent

Running a real card through Britts Bunnies to verify the payment path is the
**right** thing to do — and it must stay financially honest.

**Never fake or suppress the Stripe side.** The charge is real, the connected
account really received it, DropQ's application fee really moved, and it will
appear in the vendor's Stripe balance, payouts and tax records. Any attempt to
"exclude" it in Stripe would break reconciliation.

So:

| Layer | Treatment |
|---|---|
| Stripe | untouched — real charge, real fee, real payout |
| `Order` / `PointsLedger` / `CustomerVendor` | created normally, inherited-internal via the vendor |
| Financial reporting | **included** — it must tie out to Stripe |
| Business KPIs | **excluded** |
| DropQ fee revenue | **reported separately as internal**, not netted out |

That last point matters: netting internal fees out of revenue makes the books
stop matching Stripe. Show them as a line labelled internal instead.

Practically: **refund the test charge** afterwards where possible, and note that
the vendor-initiated refund flow is **Phase F and does not exist yet** — today
that is a Stripe-dashboard action, and DropQ will **not** reverse the DropPoints
automatically.

---

## 7. Existing Britts Bunnies / Casa Makulay data

**Recommendation: classify, don't repair.** No row surgery for the test-data
question.

| Data | Action |
|---|---|
| Casa Makulay's `$25 fulfilled/unpaid` order | **leave it.** Already leaves GMV once Phase G keys on `paymentStatus`; classifying the vendor is belt-and-braces. It is a truthful record of a real sale settled outside DropQ. |
| Britts Bunnies' library product, follows | **leave it** — inherited-internal |
| Founder's real purchases from real vendors | **leave the orders.** They are real revenue for those vendors. Exclude via `Customer.internalKind` from customer KPIs only. |
| `oauth-selftest-…@example.com` | **classify `selftest`, don't delete.** Deleting destroys the evidence that a dev selftest reached production — which is itself worth knowing. |
| Orphaned Britts Bunnies `CustomerVendor` ($1.00, no order) | **separate bug**, not a test-data question — fix with the cascade work (§8) |

Backfill required: **four `Seller` rows and two `Customer` rows.** That is the
entire migration.

---

## 8. 🔴 The cascade problem — and yes, it blocks trustworthy KPIs

`Order.dropId` is `onDelete: Cascade`. **Deleting a Drop deletes its Orders,
including paid ones.** `deleteDropAction` exposes this to vendors today.

This is not hypothetical: the orphaned Britts Bunnies relationship
(`orderCount 1, $1.00`, zero orders) is what it looks like after the fact.
`PointsLedger` survived only because it deliberately has **no** foreign key.

Consequences for metrics:

- **Historical GMV can silently decrease.** A vendor tidying up old drops
  rewrites your revenue history.
- Every KPI built on `Order` is built on deletable ground.
- Relationship counters drift permanently out of sync with orders.

**Recommendation: `Order.dropId` → `onDelete: Restrict`**, plus
`deleteDropAction` refusing when the drop has orders and offering *close*
instead. Smallest change that makes financial history durable by construction,
and it needs no data migration — it only prevents future deletions.

`SetNull` is the alternative but requires making `dropId` nullable, which is
used everywhere for pickup/fulfilment context. Not worth it.

**This must land before you report GMV to anyone outside the company.** It does
not block the Walk-Up pilot.

---

## 9. The Walk-Up pilot gate

**Do not hard-code any vendor.** Reuse the classification, and make the flag
three-state:

```
WALKUP_ENABLED unset       → off for everyone
WALKUP_ENABLED=internal    → on for sellers with internalKind != null   ← the pilot
WALKUP_ENABLED=true        → on for everyone
```

```ts
export function isWalkUpEnabled(seller?: { internalKind: string | null }): boolean {
  const v = process.env.WALKUP_ENABLED;
  if (v === "true") return true;
  if (v === "internal") return !!seller?.internalKind;
  return false;
}
```

Why this shape:

- **No names in code.** Reclassifying a vendor changes the cohort.
- **Explicit per feature.** Internal accounts do not silently receive every
  future flag — each feature opts in by supporting `"internal"`.
- **The public `/pay/{token}` path** resolves the seller from the sale, so it
  gates correctly with no extra plumbing.
- Graduating the pilot is one env change, `internal` → `true`.

⚠️ Current `isWalkUpEnabled()` takes no argument and is called in six places.
Adding an optional parameter is backward-compatible: unset/`true` behave exactly
as today, and only the `internal` branch needs a seller.

---

## 10. Smallest clean path

### Do before Walk-Up activation — the minimum

1. **`Seller.internalKind String?`** + classify **4 rows**: Britts Bunnies
   (`canary`), Casa Makulay (`founder`), DropQ Admin (`staff`), Marble & Crumb
   (`demo`).
2. **Three-state `WALKUP_ENABLED`** (§9), so the pilot targets the canary with
   no hard-coded name.

One nullable column, four rows, one helper. Nothing else is needed to pilot
safely — and step 1 is what makes step 2 possible without naming anyone.

### Do before PostHog / Phase 8

3. **`Customer.internalKind String?`** + classify 2 rows (the founder, the
   selftest leftover).
4. **`lib/reporting.ts`** with the four named audiences, and point the existing
   surfaces at it — this is Phase G's work, now with exclusion built in from the
   start rather than bolted on.
5. **`is_internal` as a PostHog person property** set on the first `identify()`,
   plus a saved cohort. Do this on day one; backfilling person properties is
   painful.

### Do before reporting investor/business KPIs

6. **Fix the cascade** (§8) — `Restrict` + refuse-to-delete-with-orders.
   Until this lands, GMV is not durable.
7. **Repair the orphaned relationship rows** (the Britts Bunnies $1.00 row and
   the Casa Makulay purchase-facts question), using the existing
   `prisma/repair-abandoned-purchase.mjs` with `--only`.
8. **Decide the founder-as-customer question** — their real purchases from real
   vendors stay in vendor GMV, but should they count toward "active customers"?
   My recommendation: **no**, and that is exactly what `Customer.internalKind`
   buys you.
9. Add `Order.internalKind` **only if** a real vendor ever runs a smoke test.

### Deliberately not now

Cohort tables, a metrics warehouse, event sourcing, separate analytics
environments. At 10 orders and 9 customers the entire problem is two nullable
columns and one shared predicate module.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Classification is forgotten for a new founder/staff account | admin UI shows an `internal` badge; add the field to the admin vendor page so it is visible and settable |
| A KPI query hand-rolls its own `where` and skips exclusion | all KPI reads go through `lib/reporting.ts`; add a test asserting no other file aggregates `totalCents` |
| PostHog and Postgres disagree | PostHog never decides — `is_internal` is pushed from Postgres at identify time |
| Internal activity is *hidden* rather than *labelled*, making debugging harder | operational and financial audiences exclude nothing, by design (§4) |
| A canary vendor's data is later needed as real (e.g. Britts Bunnies genuinely starts selling) | `internalKind` is nullable and reversible; nothing is deleted, so clearing the field restores them to real commerce |
