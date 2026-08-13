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

- [ ] 5.1 **[YOU]** Stripe: saved payment methods needs Stripe Customers +
      SetupIntents + a webhook. Today checkout is Connect Checkout with no
      stored customer. Confirm you want this before I start.
- [ ] 5.2 `/my/payments` — list, add, remove, set default. Never store card data.
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

## PHASE 7 — Rewards **[backend does not exist]**

- [ ] 7.1 Decide the model: DropQ-wide points, vendor-specific, or credits
- [ ] 7.2 Schema + earn/redeem rules
- [ ] 7.3 `/my/rewards`. Until 7.1–7.2 exist this stays a clearly-labelled
      placeholder — no fake balances

## PHASE 8 — Analytics and admin visibility

- [ ] 8.1 Fire the customer-lifecycle events (signup, guest checkout,
      conversion, follow, save, reorder) with vendor/drop/source context
- [ ] 8.2 **[YOU]** Point `/api/track` at a real pipeline — it currently
      `console.log`s to Vercel logs, which is fine for debugging and useless
      for analysis
- [ ] 8.3 Admin: customer growth, signup sources, guest→account conversion,
      top acquiring vendors, cross-vendor purchases
- [ ] 8.4 Vendor analytics: their followers, customers they brought in,
      repeat rate — scoped so a vendor never sees platform-wide data

---

## Decisions — SETTLED

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

## Known gaps carried over

- [ ] Market schedule editor — 14 seeded markets have a day but no hours, and
      there's no UI to add them
- [ ] DropMeet candidate review UI — 4 candidates are quarantined with no way
      to action them in the admin queue
- [ ] Vendor profile "Find Us Around San Diego" — query exists, not wired into
      `/s/[slug]`
