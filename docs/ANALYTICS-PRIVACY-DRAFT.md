# Analytics — privacy policy draft, retention proposal, open questions

**Status: DRAFT FOR REVIEW. Nothing here is published.** `app/privacy/page.tsx`
is untouched, no cookie banner exists, and `ANALYTICS_MODE` is unset in every
environment, so DropQ is not currently setting an analytics cookie or recording
an analytics event anywhere.

This document exists because the code shipped before the policy did, on purpose.
The tracking system is built and off; turning it on is a policy decision.

---

## 1. What the system collects when it is enabled

Written plainly, because the policy text below has to be true and a policy that
describes something vaguer than the code is worse than no policy.

| Collected | Detail | Not collected |
|---|---|---|
| Anonymous visitor id | 128 random bits in an httpOnly cookie, 12 months | Any identifier derived from the device |
| Session id | 128 random bits, 30 minutes sliding | — |
| Page path | `/pricing`. Query string stripped and discarded | Full URLs; anything in a query string except UTM/`ref` |
| Referrer domain | `instagram.com` | The full referring URL |
| UTM parameters | source, medium, campaign, content, term | — |
| Device class | mobile / tablet / desktop | Screen size, fonts, canvas, or any fingerprint |
| Event name | From a fixed list of 14 | Free text of any kind |
| Small property bag | e.g. `plan: "starter"` | Anything on the forbidden-key list |
| Seller / customer / drop id | When known and relevant | — |

**Never collected, and structurally unable to be:** IP addresses (the
application does not read them and the table has no column), passwords, form
field values, card data, message bodies, notes, and **raw Help search terms** —
the last of these has been a compile error since Phase 4 and remains one.

Vercel logs request IP addresses at the platform level, outside the application
and under its own retention. That is worth a sentence in §6 below for accuracy.

## 2. Where it applies

Public pages only. The dashboard, admin, `/my`, `/rep` and `/messages` are
excluded in code: a signed-in vendor's page-by-page activity is not collected,
because nothing in the acquisition question needs it.

## 3. How an anonymous visitor becomes a vendor

When someone creates a vendor account, the anonymous visitor id in their browser
and the acquisition source that brought them are copied onto the new account.
From that point the pre-signup browsing is associated with a known business.
This is the point of the feature — it is what answers "which channel actually
produces vendors" — and it is the part most deserving of plain description in
the policy.

**First-touch is written once and never overwritten.** Last-touch is recorded
separately and updated by each later qualifying source.

---

## 4. Proposed privacy-policy changes

Three edits. Wording is a draft for review and is not legal advice.

### 4.1 — Section 6, replacing the current paragraph

> **6. Cookies & Similar Technologies**
>
> We use essential cookies to keep you signed in and to operate the Services
> securely. We do not use third-party advertising cookies and we do not allow
> third parties to track you across other websites through DropQ.
>
> We also use our own first-party analytics cookies to understand how people
> find and use DropQ. These store a random identifier and nothing else — no
> name, no email, no device fingerprint — and are readable only by our servers,
> never by scripts running in your browser. We use them to count visits, to see
> which pages and links bring people to DropQ, and to understand where people
> get stuck when setting up a store.
>
> | Cookie | Purpose | Expires |
> |---|---|---|
> | Session cookie | Keeps you signed in (essential) | On sign-out or expiry |
> | `dq_touch` | Records which vendor you arrived through, so orders are credited correctly (essential) | 30 days |
> | `dq_vid` | Random analytics identifier for one browser | 12 months |
> | `dq_sid` | Random identifier for one visit | 30 minutes of inactivity |
> | `dq_attr` | The link or campaign you arrived through | 90 days |
>
> Most browsers let you control cookies. Disabling essential cookies may prevent
> you from logging in; disabling analytics cookies does not affect anything you
> can do on DropQ.

### 4.2 — A new section 6a

> **6a. Analytics**
>
> We record a small number of product events on our public pages: which page was
> viewed, whether a visitor opened vendor signup, and whether they went on to
> create a store, connect payments, publish a drop or make a sale. Each event is
> stored with the random identifiers described above, the page path, the
> referring website's domain, any campaign tags in the link you followed, and a
> broad device type (mobile, tablet or desktop).
>
> We do not record the web address you came from beyond its domain, the contents
> of anything you type, your search terms, or any information you enter into a
> form. We do not use session recording, screen recording or heatmaps.
>
> If you create a vendor account, we associate your earlier anonymous activity
> on our public pages with that account, so we can understand which channels
> bring vendors to DropQ.
>
> Analytics for our own internal, staff and test accounts is excluded from our
> business reporting.
>
> Our analytics data is stored in our own database. We do not sell it, and we do
> not share it with advertising networks.

### 4.3 — Section 7, an added paragraph

> Anonymous analytics events are retained for 90 days and then deleted.
> Aggregate figures derived from them — counts and conversion rates, containing
> no identifiers — may be retained longer. Where anonymous activity has been
> associated with a vendor account, the summary of how that account was acquired
> is retained for the life of the account, in the same way as other account
> records.

---

## 5. Retention proposal

| Data | Retention | Reason |
|---|---|---|
| Raw `AnalyticsEvent` rows | **90 days** | Enough to see conversion over a realistic consider-then-sign-up gap, short enough that a visitor's browsing is not kept indefinitely. Your suggested figure; I have no reason to argue for longer. |
| Aggregates (counts, rates) | Indefinite | Numbers, not people. Built only when the raw query gets slow — not in Phase A. |
| `Seller` acquisition columns | Life of the account | A business fact about a customer relationship, exactly like `referredAt`. |
| `dq_vid` | 12 months | Covers the gap between first look and signup. |
| `dq_sid` | 30 minutes sliding | Defines one sitting. |
| `dq_attr` | 90 days | Matches raw event retention. |

**Not implemented.** No scheduled deletion job exists yet, per your instruction.
When approved it is one cron entry against the indexed `at` column — the cron
infrastructure already exists. Until then nothing accumulates, because nothing
is being written.

---

## 6. Open questions for you (and, where noted, for a lawyer)

1. **Consent posture.** The system supports `off`, `on` and `consent` today.
   Which do you want in production? Whether a consent banner is legally required
   for first-party, non-advertising analytics in your markets is a question for
   a lawyer — I am not making that determination, and the code does not assume
   an answer.
2. **Policy first, or together?** The recommended order is: approve the policy
   text → publish it → *then* set `ANALYTICS_MODE`. That way the promise and the
   behaviour never disagree, even briefly.
3. **The `dq_touch` cookie is already live** and is not mentioned in the current
   policy. It is arguably essential — it credits orders to the right vendor —
   but it is a first-party tracking cookie by any plain reading, and this is a
   good moment to describe it rather than let it stay undescribed.
4. **Existing customer classification.** `Customer.internalKind` ships NULL for
   all 24 existing rows. Two are known internal — the founder and an
   `oauth-selftest-...@example.com` leftover recorded in
   `docs/TEST-DATA-AND-METRICS.md` §0. I have **not** classified them: that is a
   data change and needs your explicit approval with the exact rows named.
5. **Vercel platform logs.** Request IPs are logged by Vercel regardless of what
   DropQ does. Worth one sentence in the policy for accuracy; worth checking
   what Vercel's retention actually is before writing a number.
