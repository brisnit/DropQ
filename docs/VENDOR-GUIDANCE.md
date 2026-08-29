# DropQ Phase G — Vendor Onboarding, Guidance & Help

**Status: G.1 + G.2 BUILT AND TESTED, NOT DEPLOYED. Migration APPLIED 2026-08-29. G.3–G.6 not started.**

Goal: a vendor who has never seen DropQ can sign up, understand what it does,
create a drop, connect Stripe, publish, share, and manage orders **without a
person explaining it** — while an experienced vendor is left alone.

Companion to `docs/VENDOR-ACTIVATION.md`, which owns *activation* (what a vendor
has done, and whether they can sell). This document owns *guidance* (what we
explain, and whether we already have). The two are deliberately separate
modules with the same discipline.

Verified against the repo at `5c8ffa4`. Where docs and repo disagreed, the repo
won — see §5.

---

## 1. The one architectural rule

> **Anything derivable from vendor state stays derived. Only what the vendor did
> to the guidance UI is stored.**

`lib/activation.ts` established this: a cached `readyToSell` flag would go stale
the moment Stripe revokes charges. Guidance inherits it. `VendorGuidance` holds
tour position, dismissals, `sharedAt` and `helpOpenedAt` — facts with no
upstream source of truth to drift from. Milestones, tiers, percentages,
"can they sell", "have they published" are all derived on every render.

The test for a new column: *can this be computed from Seller / Drop / Product /
Order?* If yes, it does not go in the table.

---

## 2. Approved decisions (2026-08-29)

| # | Decision | Consequence in code |
|---|---|---|
| **1** | **One checklist, FIVE milestones** (revised 2026-08-29): account → connect Stripe → build first drop → publish → **share**. Email verification removed entirely, not just deprioritised. | Shipped in G.2. Email verification gates nothing — login, publishing and selling all work unverified — so it is not an activation step; the `VerifyBanner` keeps it as an account-security task. Keeping the total at five also meant no vendor's denominator moved. The brief's "complete your vendor profile" and "choose when customers can order" items stay **dropped**: every profile field is nullable, and dates are part of creating a drop. |
| **2** | **Followers.** Fix the misleading copy now; expose a follower **count** in G.3; do **not** make followers a broadcast audience in this project. | Done in G.1 — see §5. A follower audience needs its own consent decision: `CustomerVendor` deliberately separates `followedAt` from `emailMarketingConsent` / `smsMarketingConsent`. |
| **3** | **Share milestone.** Track Copy link / Share / QR download; store `sharedAt`. | `VendorGuidance.sharedAt` + `markSharedAction()` built in G.1, **wired in G.2**. |
| **4** | **Existing vendors** never get the welcome modal unprompted; they opt into the tour from Help. | The migration backfills one `VendorGuidance` row per existing seller with `welcomeSeenAt` stamped and `tourStatus` left `not_started`. |
| **5** | **No raw help-search queries.** Track usage, zero-result rate, article views. | `GuidanceEventProps["help_searched"]` is `{ queryLength, resultCount, zeroResults }` and structurally cannot carry a `query`. Pinned by the self-test. |
| **6** | **Screenshots** via Playwright devDependency + a dedicated docs vendor; `data-guidance-anchor` shared by coachmarks and screenshot annotation. | Anchor registry shipped in G.1. Pipeline is G.5. |
| **7** | **FAQ accuracy.** Fix or flag doc/product contradictions before publishing help content. | §5. |
| **8** | **Walk-up and DropMeet** content stays conditional on real availability. | `GuidanceCapabilities` is passed in by the caller from the same server-side gates the features use — guidance never re-implements a gate. |
| **9** | **Six illustrated walkthroughs** first; everything else text-first. | G.4 / G.5. |

---

## 3. Three tiers, not four

The audit proposed an "advanced" tier for walk-up and DropMeet. **Changed during
implementation.** Those are *feature availability*, not vendor progress: a
brand-new vendor in the walk-up pilot has access on day one, and an experienced
vendor outside it never will. Folding an env flag into a progress tier would
make the tier change with `WALKUP_ENABLED` — untestable, and it would "promote"
a vendor who did nothing.

```
beginner    → no paid order. Everything still needs explaining.
selling     → has taken money. Stop explaining the basics.
established → a repeat customer, or a second drop that sold.
```

Availability travels separately in `GuidanceCapabilities { walkUp, dropMeet,
growthFeatures }`, resolved by the caller from `isWalkUpEnabled(seller)`, a live
DropMeet region, and `hasGrowthFeatures(seller)`.

---

## 4. Six tour steps, not seven

The brief's seventh step was "Products". There is **no dashboard element to
anchor it to** — adding products happens inside the drop editor, reached by an
action the tour must not take on the vendor's behalf. Teaching it as a floating
card would break the rule that the tour highlights the real interface. It is
taught in place instead, by the `editor.*` coachmarks, at the moment it happens.

---

## 5. Documentation vs. behaviour — findings

Fixed in G.1:

| Finding | Was | Actually |
|---|---|---|
| **Follower notifications** (`app/dashboard/page.tsx`, `app/page.tsx`) | "Publish it to start taking orders and notify your followers"; "Text your followers the second a drop goes live" | Following is real (`CustomerVendor.followedAt`) but there is **no vendor-facing follower list, count, or message audience**. `resolveAudience()` resolves every broadcast from **orders**. Copy now refers to customers and sharing. |
| **Payment architecture** (`README.md`) | "a **destination charge** with an `application_fee_amount`" | `lib/actions/order.ts` calls `stripe.checkout.sessions.create(params, { stripeAccount })` — a **direct charge on the connected account**. The **vendor is merchant of record and pays Stripe's processing fee**; DropQ's `DROPQ_FEE_PERCENT` is on top. Corrected, with a note explaining why it matters for help content. |

Still open, deliberately not fixed in G.1:

- **Dead footer links.** `components/site-footer.tsx` points *Help center*,
  *Resources* and *About* at `/#`. Help center is repointed in G.4 when
  `/help` exists; the other two are still dead and are not this project's.
- **`README.md` architecture section is badly stale** — it lists 5 models and
  ~7 routes; there are 38 models and 40+ routes. Out of scope here, worth a
  pass of its own.

### Possible unintended product decisions — flagged, not changed

1. ~~**Removing an item row from a live drop deletes the `Product`.**~~
   **RESOLVED 2026-08-29** — see §8. Items with orders are retired, never
   deleted, and the editor confirms first.
2. **`Drop.mode` is fixed at creation.** The editor has no control to change
   preorder ↔ live, so a vendor who picks wrong must delete and start over —
   and on the Free plan that burns one of three **lifetime** drops.
3. ~~**Email verification never gates anything** yet is milestone #2.~~
   **RESOLVED 2026-08-29** — removed from the checklist (decision 1). It gates
   nothing and is now presented only as the account-security task it is.

4. **Relaunch consumes a lifetime drop allowance.** `duplicateDropAction`
   increments `dropsCreated` like a fresh create, so a Free vendor who relaunches
   twice has spent all three lifetime slots without building a new menu. Flagged
   during the preflight review; not this project's to fix. Two candidate fixes
   are recorded there: refund a never-published drop on delete (~3 lines, no
   schema), or count first publishes instead of creations (one nullable column,
   a pricing-promise change needing approval).

---

## 6. Phases

| Phase | Contents | Status |
|---|---|---|
| **G.1** Foundation | `VendorGuidance` + migration, `lib/guidance.ts` (pure), `lib/guidance-state.ts`, `lib/actions/guidance.ts`, overlay / coachmark / tooltip / anchor primitives, analytics vocabulary, self-test | ✅ built, tested, **not deployed** |
| **G.2** First-time onboarding | welcome modal, 6-step tour, 5 anchors at call sites, share milestone + wiring, first-publish celebration, per-row actions | ✅ built, tested, **not deployed** |
| **G.3** Contextual guidance | coachmarks, tooltips, smart tips, empty-state rewrites, follower count, tier-based promotion | not started |
| **G.4** Help centre | `lib/help/content.ts`, search, panel, `/help`, footer link | not started |
| **G.5** Visual documentation | Playwright, docs vendor, capture + annotate + `--check`, six walkthroughs | not started |
| **G.6** Intelligence | next-best-action beyond the dashboard, remaining tips, PostHog wiring | not started |

Every phase ships behind its own verification. G.1's is
`curl localhost:3000/api/dev/guidance-selftest` (82 assertions, pure).

---

## 7. G.1 — as built

### 7.1 Schema

One new table, **zero alterations to existing tables**, no data deleted.
Migration `20260829174510_add_vendor_guidance`, **authored but NOT applied** —
this repo's `.env` points `DATABASE_URL` at the production Neon branch, so
applying it is a deliberate, separately-approved step:

```
npx prisma migrate deploy
```

The backfill inserts one row per existing seller with `welcomeSeenAt` set
(decision 4). It uses `'gseed_' || "Seller"."id"` as the id and
`ON CONFLICT DO NOTHING`, so re-running it is a no-op rather than an error.
It deliberately does **not** set `tourStatus = 'skipped'`: those vendors did not
skip anything, and Help must still offer them the tour.

### 7.2 The four properties the self-test protects

1. **At most one interruption per render.** `guidanceFor()` enforces
   welcome > tour > coachmark > tip. Swept across 75 state/route/fact
   combinations; the maximum number of simultaneous interruptions is 1.
2. **Never shown twice.** Dismissals are permanent; `welcomeSeenAt` is stamped
   on *display*, not dismissal, so closing the tab cannot produce a second
   showing.
3. **Never points at nothing.** Every coachmark and tour step names an anchor
   in the `ANCHORS` registry, on the route it claims. Enforced by types and
   asserted at runtime.
4. **Never covers what it describes.** `computePlacement()` swept over 1,000+
   anchor/viewport combinations: zero overlaps, zero viewport escapes.

### 7.3 A real bug the self-test caught

`computePlacement()` chose a left/right placement using only horizontal fit. A
bubble taller than the viewport therefore "fitted" beside a left-edge anchor and
ran off the top and bottom of the screen. Fixed by rejecting any bubble that
cannot fit the viewport in *either* axis before considering sides — it docks
instead.

### 7.4 What is deliberately inert

Every component and action in G.1 is complete, typed and tested but **called by
nothing**. `npm run build` compiles them; no vendor sees anything different. The
only user-visible changes in G.1 are the two copy corrections in §5.


---

## 8. Live-drop item removal — as shipped (Option A)

`updateDropFullAction` no longer deletes every product missing from the form.
The decision is `planRemovals()` in `lib/drop-items.ts` — pure, so it is
asserted without a database:

- **no orders** → deleted, exactly as before;
- **has orders** → never deleted, *retired* with
  `UPDATE "Product" SET inventory = sold`.

Retiring reuses the sold-out mechanism the product already enforces in four
independent places (storefront render, inventory poll, `placeOrderAction`, and
the atomic `sold + qty <= inventory` write), so no purchase path needed a new
filter — which is exactly why this was chosen over an `archivedAt` column.
Missing one of six purchase-path reads would have let a customer buy an item the
vendor believed they had removed.

The update is raw and set-based on purpose: reading `sold` in JS from the
products loaded at the top of the action would lose a purchase that landed
mid-edit and leave the item buyable.

The editor confirms first, using `removalWarning()`, fed by an `orderItems`
count added to the edit page's existing product query.

**Production state when this shipped:** 17 of 32 products were referenced by an
order, all in *closed* drops, and there were **zero** severed order lines — the
destructive path had never actually fired.

Suite: `curl localhost:3000/api/dev/drop-items-selftest` — 23 assertions, pure.

---

## 9. G.2 — as built

### 9.1 What a vendor sees

1. **Welcome modal**, once ever, gated on `welcomeSeenAt === null` and
   `guidanceApplicable()`. Two buttons, a real ✕, Escape, backdrop, focus
   return. Stamped on *display*, not dismissal.
2. **Six-step tour**, orientation only. Back / Next / Skip / ✕ / "3 of 6",
   arrow keys, Escape.
3. **Five-milestone checklist** with a per-row action link on every incomplete
   row.
4. **First-publish celebration** — one line inside the compact card.

### 9.2 Two decisions worth recording

**The tour docks instead of skipping.** Three of six steps point at sidebar nav
items, and the sidebar is `hidden md:flex` — on a phone those elements are
genuinely absent from the DOM. Skipping a step with a missing anchor would drop
half the tour on the device most DropQ vendors use at a market. A tour step with
no anchor docks to the bottom of the screen and keeps its copy; a *coachmark*
with no anchor still renders nothing, because it has no subject.

**The share signal is opt-in.** `ShareButton` takes `signalDropShare`, set only
on the drop page. The walk-up screen uses the same component to hand one
standing customer a payment link — a sale, not putting a drop in front of an
audience — and `CopyLinkButton` is the *referral* link. Both are asserted to
stay unsignalled.

### 9.3 Verification

| Suite | Result |
|---|---|
| `guidance-selftest` | 105 passed |
| `drop-items-selftest` | 23 passed |
| `activation-selftest` | 151 passed |
| `payments-selftest` | 184 passed |
| `test:phase-a` | 77 passed |
| `test:drop-schedule` | 44 passed |
| `tsc --noEmit` / `npm run build` | clean |

Plus a read-only render check against production data (signed `hp_session`
cookie, the `date-picker-selftest` technique): all five anchors present exactly
once, no welcome or tour for an internal account, checklist reading "of 5
complete" with *Share your drop* present and *Verify your email* absent from the
card but still on the page in its banner.

**Not verified by a live render:** the welcome modal and tour appearing for a
brand-new vendor. Every production seller was backfilled with `welcomeSeenAt`,
and creating or reclassifying a vendor to test it would be a production write.
That path is covered by the pure assertions in `guidance-selftest` (§7.2) and by
the build.

---

## 10. Starter lifetime drop allowance — the policy, stated plainly

**Policy unchanged** (confirmed 2026-08-29). Documented here because it is a
one-way door that the product previously did not spell out.

The Free plan includes **3 drops, lifetime**. The counter is
`Seller.dropsCreated`, incremented on creation and **never decremented** — which
is deliberate, and says so in `lib/actions/dashboard.ts`:

```
// Count it against the lifetime allowance (never decremented, so deleting a
// drop doesn't refund a Starter slot).
```

Three consequences a vendor must not discover by accident:

1. **Deleting a drop does not give the slot back.** A test drop, a mistake, or a
   drop deleted five minutes after creating it all still count.
2. **Relaunch creates a NEW drop and consumes another slot.**
   `duplicateDropAction` increments the same counter. A Free vendor who
   relaunches twice has used all three lifetime drops without ever building a
   second menu.
3. **Picking the wrong drop mode costs a slot.** `Drop.mode` is fixed at
   creation, so correcting it means delete-and-recreate — which spends one.

### Where this is now stated to vendors

| Surface | Wording |
|---|---|
| `/dashboard/drops` Starter banner | "…lifetime drops remaining. Deleting or relaunching a drop doesn't give a slot back." |
| Relaunch button tooltip (drops list **and** drop detail) | "Copies this drop into a NEW draft. On the Free plan it counts as another of your 3 lifetime drops." |
| Pricing card (`lib/plans.ts` → `/pricing`) | "3 drops total (lifetime — deleting or relaunching doesn't refund one)" |

Copy only — no behaviour changed. The two candidate fixes (refund a
never-published drop on delete; or count first publishes instead of creations)
remain **unapproved and unbuilt**.

---

## 11. G.3 — contextual guidance, as built

**Status: BUILT AND VERIFIED, NOT DEPLOYED.**

### 11.1 Six coachmarks, mounted

| Coachmark | Anchor | Shown to | Guard |
|---|---|---|---|
| `drops.mode` | mode chooser on `/dashboard/drops` | beginner + selling | — |
| `editor.orderWindow` | "Customers can order" label | beginner | — |
| `editor.pickupWindow` | "Customers pick up" label | beginner | — |
| `editor.inventory` | first quantity field | beginner | — |
| `drop.publish` | Publish control | beginner + selling | **only when `readyToSell`** |
| `drop.qr` | QR card | beginner + selling | — |
| `drop.close` | Close drop | beginner + selling | only once paid orders exist |

One at a time, in journey order, permanent on dismissal. The decision stays in
`coachmarkFor()`; the client computes it against `usePathname()` because a
layout has no server-side pathname — which is what `lib/guidance.ts` was kept
pure for.

### 11.2 Three fixes the browser forced

1. **Anchors are scrolled into view.** The order-window label sits ~880px down
   a 900px viewport; guidance was explaining a control below the fold.
2. **The bubble re-measures itself.** First placement used an assumed height;
   the real bubble was 58px taller and overlapped the control it pointed at. A
   `ResizeObserver` corrects it on the next frame.
3. **Anchors are labels, not sections.** `editor.orderWindow` originally
   wrapped the whole section — 719px tall with its calendar — leaving a bubble
   nowhere to go but on top of it.

Plus: a bubble under a much wider anchor now aligns to the anchor's start
rather than centring, so it stops covering the control the label introduces.

### 11.3 Tips: overview only, never duplicating the card

`tipFor()` returns null off `/dashboard`, and null while the activation card is
visible. The card is the next-action surface during activation; tips take over
afterwards for the ongoing lifecycle (a new drop with no items, the first paid
order, repeat customers). Without that rule a tip would repeat "Connect Stripe"
directly under a card saying "Connect Stripe" — the duplication Phase V removed.

### 11.4 Route matching hardened

`RESERVED_SEGMENTS` stops a `[param]` capturing `/drops/new`, `/edit` and
`/sale`. Before this, every drop-detail anchor "matched" the editor, so
`coachmarkFor` would select one there, render nothing (the element is not on
that page) and starve the editor coachmark that should have shown.

---

## 12. G.4 — Help Center, as built

**Status: BUILT AND VERIFIED, NOT DEPLOYED.**

### 12.1 Three corrections shipped first

| Correction | What changed |
|---|---|
| **First-order celebration** | Now REPLACES the dashboard's next-step card for that one state (`app/dashboard/page.tsx`), instead of a tip appearing beneath a card saying the same thing. `first_order` was removed from `TIPS`; the celebration is derived from `paidOrders === 1` and retires itself at the second order. *View order* is preserved. |
| **Draft status copy** | `dropPhaseNote()` in `lib/drop-status.ts` replaces a ternary fall-through that told a vendor their unpublished draft had "Ordering closed". A draft now reads "Not published yet — customers can't see this drop." Asserted for all five static phases plus a source pin that the inline string is gone. |
| **Coachmark expiry** | Unchanged, as instructed. A coachmark stays available until dismissed, subject to the existing route, tier and capability rules. |

### 12.2 Content architecture

`lib/help/content.ts` — **51 articles** across 11 categories, one typed array
powering the in-app panel, the public `/help` pages, search, contextual
suggestions, and whatever comes next.

Every article carries `verifiedAgainst`, naming the code its answer was checked
against. The self-test refuses an article without it, and **checks that every
file named actually exists** — so a rename surfaces the articles it invalidated
instead of leaving them quietly wrong.

Capability-gated articles (`requires: "walkup" | "dropmeet" | "growth"`) are
filtered by the same gates the features use. A gated article 404s on the public
route rather than describing a feature the reader does not have.

### 12.3 Search

Deterministic scoring over the array — exact phrase in title, then question,
then keyword, then term matches with the body weighted lowest so an article that
mentions Stripe once cannot outrank the article *about* Stripe. The current
route adds a small bonus but never filters.

**No raw query is ever recorded.** The panel reports `queryLength`,
`resultCount` and `zeroResults`; the event's props type has no `query` field,
and the search module contains no logging at all. Three assertions pin this.

### 12.4 Where Help lives

One panel (`HelpHost`), many doors (`HelpTrigger`). Both dashboard headers are
always in the DOM — one is `hidden md:flex` — so a component that both triggered
and rendered the panel mounted twice and opened two overlapping dialogs on a
phone. The split is the fix.

The Phase 2 emergency sidebar tour button is **retired**; the tour now restarts
from inside Help, which is what the welcome modal has always promised.

### 12.5 Verification

| Suite | Result |
|---|---|
| browser — guidance | 91 passed |
| browser — help | 65 passed |
| `help-selftest` | 72 passed |
| `guidance-selftest` | 180 passed |
| `activation` / `payments` / `drop-items` | 151 / 184 / 23 |
| `test:phase-a` / `test:drop-schedule` | 77 / 44 |
| `tsc --noEmit`, `npm run build` | clean |
