# Privacy policy — final proposed patch, and one decision to make

**Status: PROPOSED. Not published.** `app/privacy/page.tsx` is untouched, no
consent banner exists, `ANALYTICS_MODE` is unset in all three Vercel
environments, and `AnalyticsEvent` has 0 rows.

This replaces the earlier draft. It is written against the shipped
implementation rather than the plan, and it now covers **`dq_touch`, which has
been live in production since long before any of this and is not described in
the current policy**.

---

## 1. Every cookie DropQ sets, exactly

| | `dq_touch` | `dq_vid` | `dq_sid` | `dq_attr` |
|---|---|---|---|---|
| **Live today** | **Yes** | No | No | No |
| **Created when** | First visit to `/s/<slug>` or `/s/<slug>/<dropId>` | Any public page, when `ANALYTICS_MODE` ≠ off | Same | Same, when the visit carries an acquisition signal |
| **Created by** | `middleware.ts` → `vendorFirstTouch()` | `middleware.ts` → `visitorIdentity()` | Same | Same |
| **Why** | Credits an order to the vendor whose link or QR brought the customer | Recognises one browser across visits | Groups one sitting | Remembers the link or campaign someone arrived through |
| **Contents** | Vendor slug, drop id, source (`qr`/`storefront`/`drop`), `ref`/`utm_source`, timestamp | 128 random bits, hex | 128 random bits, hex | First and last touch: channel, source, medium, campaign, content, term, landing path, timestamps |
| **Retention** | 30 days | 12 months | 30 minutes, sliding | 90 days |
| **Necessary for the product?** | **Yes** — vendor attribution and sales-rep commission depend on it | No | No | No |
| **JavaScript access** | None — `httpOnly` | None — `httpOnly` | None — `httpOnly` | None — `httpOnly` |
| **First write wins?** | Yes, never overwritten | Reissued only if absent | Slides with activity | `first` never overwritten; `last` updates |
| **Associates with, server-side** | `Customer.firstVendorId`, `signupSource`, `firstTouchAt`; `CustomerVendor` | `AnalyticsEvent.visitorId`; `Seller.firstTouchVisitorId` after signup | `AnalyticsEvent.sessionId` | `AnalyticsEvent` UTM columns; `Seller.signupSource/​signupCampaign/​lastTouch*` |
| **Third parties** | None | None | None | None |

All four are first-party, `httpOnly`, `sameSite=lax`, `secure` in production.
None is readable by page scripts. None is shared with anyone.

**`dq_touch` deserves its own note.** It is the oldest of the four and the only
one live today. It is arguably "essential" — without it a customer who arrives
through a vendor's QR code is not credited to that vendor, which affects real
commission payments — but it is a first-party tracking cookie by any plain
reading, and the current §6 does not mention it. That gap exists now, whatever
you decide about analytics.

## 2. What the analytics system records when enabled

Path (query string stripped), referrer **domain** only, the five UTM parameters,
device class (mobile/tablet/desktop), event name from a fixed list of 14, a
small property bag, and the ids above. Plus `sellerId`/`customerId`/`dropId`
where known.

**Structurally impossible to record:** IP addresses (never read, no column),
query-string values other than UTM and `ref` (an allowlist, so anything new is
excluded by default), full referrer URLs, full URLs, passwords, form values,
card data, message bodies, and **raw Help search terms**.

Public pages only. `/dashboard`, `/admin`, `/my`, `/rep` and `/messages` are
excluded in code.

---

## 3. The proposed patch

Three edits to `app/privacy/page.tsx`. Wording is a proposal for your review,
not legal advice.

### 3.1 Replace Section 6

> **6. Cookies & Similar Technologies**
>
> We use only first-party cookies — cookies set by DropQ itself. We do not use
> third-party advertising cookies, and we do not allow third parties to track
> you across other websites through DropQ. None of our cookies can be read by
> scripts running in your browser.
>
> | Cookie | What it does | Expires |
> |---|---|---|
> | Session cookie | Keeps you signed in. Essential. | On sign-out or expiry |
> | `dq_touch` | Records which vendor's link, storefront or QR code you arrived through, so that vendor is credited for the order. Essential to how DropQ pays vendors and sales representatives. | 30 days |
> | `dq_vid` | A random number identifying one browser, used for analytics. Contains no personal information. | 12 months |
> | `dq_sid` | A random number identifying one visit. | 30 minutes of inactivity |
> | `dq_attr` | The link or marketing campaign you arrived through. | 90 days |
>
> Most browsers let you control cookies. Disabling essential cookies may prevent
> you from logging in or prevent a vendor from being credited for your order.

*(If decision B is chosen, add: "The three analytics cookies are set only if you
agree to analytics.")*

### 3.2 Add Section 6a

> **6a. Analytics**
>
> On our public pages we record a small number of product events — which page
> was viewed, whether someone opened vendor signup, and whether they went on to
> create a store, connect payments, publish a drop or make a sale. Each event is
> stored with the random identifiers above, the page address (without anything
> after the "?"), the domain of the website you came from, any campaign tags in
> the link you followed, and a broad device type.
>
> We do not record the full web address you came from, anything you type, your
> search terms, or any information you enter into a form. We do not use session
> recording, screen recording or heatmaps. We do not store your IP address in
> our analytics records.
>
> We do not collect analytics on the vendor dashboard or the admin area.
>
> If you create a vendor account, we associate your earlier anonymous activity
> on our public pages with that account, so we can understand which channels
> bring vendors to DropQ.
>
> Analytics from our own internal, staff and test accounts is excluded from our
> business reporting.
>
> This data is stored in our own database. We do not sell it and we do not share
> it with advertising networks.

### 3.3 Add to Section 7 (Data Retention)

> Anonymous analytics events are retained for 90 days and then deleted.
> Aggregate figures derived from them — counts and conversion rates containing
> no identifiers — may be retained longer. Where anonymous activity has been
> associated with a vendor account, a summary of how that account was acquired
> is retained for the life of the account, like other account records.

---

## 4. The decision: A or B

Both are already built. `ANALYTICS_MODE` takes `off`, `on` or `consent`, and
nothing else changes between them — same cookies, same events, same retention.
The difference is **who gets measured**.

### A — `ANALYTICS_MODE=on`

Identity cookies are set for every visitor to a public page.

- **You see everyone.** Conversion rate is visitors ÷ signups with no gap.
- **No banner**, so nothing gets in front of a first-time visitor — which
  matters when the whole point is to find out why first-time visitors leave.
- **Publish the policy first**, then set the variable. The promise and the
  behaviour must never disagree, even for an hour.

### B — `ANALYTICS_MODE=consent`

Identity cookies are set only after a visitor's browser holds
`dq_analytics_consent=granted`. Until then: no `dq_vid`, no `dq_sid`, no
`dq_attr`, no events. Someone who declines is invisible, not anonymised —
nothing about them is recorded at all.

- **Needs a banner**, which does not exist yet. Roughly a day: a small client
  component that writes the consent cookie, plus a line in the policy. No change
  to the tracking system.
- **Your numbers become a sample.** If 40% accept, "142 visitors" means "142 of
  the people who accepted", and your conversion rate is computed over that
  subset. The bias is not random: people who decline cookies are systematically
  different from people who accept.
- **The banner is itself a funnel step.** A modal in front of the homepage is
  the first thing a prospective vendor meets.
- **`dq_touch` is unaffected either way** — it is product functionality, not
  analytics, and it stays on.

**My recommendation: A, after the policy is published.** DropQ collects less
than most sites' "essential" tier — no IP, no fingerprint, no third party, no
cross-site anything — and at four real vendors, a sampled funnel would not
answer the question you are asking. Revisit if you take on EU/UK traffic in
volume.

**Whether a consent banner is legally required in your markets is a question
for a lawyer. I am not making that determination**, and the implementation
deliberately assumes neither answer.

---

## 5. Retention (approved, not yet enforced)

| Data | Retention |
|---|---|
| Raw `AnalyticsEvent` rows | 90 days |
| Aggregates | Indefinite |
| `Seller` acquisition columns | Life of the account |
| `dq_vid` / `dq_sid` / `dq_attr` | 12 months / 30 min sliding / 90 days |

`ANALYTICS_RETENTION_DAYS = 90` and `retentionCutoff()` exist in `lib/utc.ts`.
**No deletion job is scheduled** — that lands when analytics is enabled.

## 6. Sequence when you decide

1. Approve the wording above.
2. Publish the policy (a normal deploy).
3. If B: build the banner and ship it.
4. Set `ANALYTICS_MODE` in Production only.
5. Enable the retention job.
6. Then Phase B wires the funnel events, and Phase C builds the dashboard.

Steps 1–2 must precede step 4.
