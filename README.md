# DropQ — MVP

**The operating system for modern food businesses.** A working MVP of the full
drop-commerce loop: a seller creates a store and a *drop* (a limited menu sold in
a window), shares one link, and buyers order from a public storefront while the
seller watches orders and inventory update in real time.

Built with **Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 ·
Prisma · Postgres**, with Vercel Blob for image uploads, Stripe Connect for
payments, and Resend for email. Designed to deploy on Vercel.

---

## Quick start (local)

Uses **Postgres** (same as production). Easiest local DB is a free
[Neon](https://neon.tech) project — copy its connection string into `.env` as both
`DATABASE_URL` and `DATABASE_URL_UNPOOLED`. Then:

```bash
cp .env.example .env                    # then fill in DATABASE_URL(+UNPOOLED), SESSION_SECRET
npm install
npx prisma db push                      # creates tables
node --env-file=.env prisma/seed.mjs    # optional: seeds the showcase storefront
npm run dev
```

Open the app at **http://localhost:3000**. With no `BLOB_READ_WRITE_TOKEN` set,
image uploads are written to `/public/uploads` locally.

## Deploy to Vercel

1. **Database** — Vercel project → **Storage → Create → Postgres** (Neon). This
   injects `DATABASE_URL` + `DATABASE_URL_UNPOOLED` into the project.
2. **Image uploads** — **Storage → Create → Blob**. This injects
   `BLOB_READ_WRITE_TOKEN`.
3. **Env vars** (Project → Settings → Environment Variables) — add:
   `SESSION_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `DROPQ_FEE_PERCENT`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`
   (your live URL). The DB + Blob vars are added automatically by steps 1–2.
4. **Redeploy.** The build runs `prisma generate && prisma db push && next build`,
   which creates the tables on first deploy.
5. **Stripe webhook** — point a Stripe webhook at
   `https://YOURDOMAIN/api/stripe/webhook` and put its signing secret in
   `STRIPE_WEBHOOK_SECRET`.

### Accounts
There is **no demo login**. Create a real account at **`/signup`** (email +
password). The optional seed creates a read-only **showcase storefront** at
`/s/marble-crumb` for the marketing "See a live store" link — it has a random
password and cannot be logged into.

---

## Try the full loop in 60 seconds

1. **Sign up** at `/signup` to create your store, then **+ New drop** → add a few
   items → **Publish** → copy the share link.
2. **Open your storefront** (incognito window), tap **Add** on a couple of items,
   fill name + email, **Place order** → confirmation page. (In demo mode no real
   payment is taken; with Stripe connected it's a real checkout.)
3. Back in the **dashboard**: the new order appears under **Orders**, inventory
   ticks up on the **drop page**, and the buyer shows up under **Customers**.
4. Browse a ready-made example anytime at **`/s/marble-crumb`** (run
   `npm run db:seed` once to create it locally).

---

## What's implemented

**Marketing**
- Editorial, food-forward homepage (hero with a live-drop mockup, problem,
  how-it-works, drops explained, feature grid, testimonial, pricing teaser, CTAs)
- Email/password auth with a signed, http-only cookie session

**Seller dashboard** (`/dashboard`, auth-guarded)
- **Overview** — a “what should I do next?” engine (publish a draft, prep new
  orders, start a new drop) + revenue/orders/customers stats + live-drop snapshot
- **Drops** — list, **create drop** (dynamic menu-item editor with emoji picker),
  **manage drop** (publish / close / reopen, share link, per-item sell-through,
  live order list, delete)
- **Orders** — all orders with status filters; update status inline
- **Customers** — auto-built customer list with repeat-rate
- **Analytics** — best sellers, revenue by drop, AOV (+ AI forecasting teaser)
- **Store** — edit storefront name, story, location, brand accent color

**Buyer storefront** (public, themed by the seller's accent)
- Store page (`/s/[slug]`) with live + past drops
- Drop ordering page (`/s/[slug]/[dropId]`) — cart with quantity steppers,
  **server-enforced inventory** (can't oversell), one-step checkout
- Order confirmation (`/order/[id]`)

---

## Architecture

```
app/
  page.tsx                  Marketing homepage
  login/  signup/           Auth (server actions + useActionState)
  dashboard/                Auth-guarded seller app (layout = guard + nav)
    page.tsx                Overview
    drops/  drops/new/  drops/[id]/
    orders/  customers/  analytics/  store/
  s/[slug]/                 Public storefront
  s/[slug]/[dropId]/        Drop ordering
  order/[id]/               Confirmation
  generated/prisma/         Prisma client (generated)
components/                 Logo, UI kit, nav/footer, editors, cart
lib/
  db.ts                     Prisma singleton
  auth.ts                   bcrypt + HMAC-signed cookie session
  format.ts                 money / date / status helpers
  actions/                  Server actions: auth, dashboard, order
prisma/
  schema.prisma             Seller · Drop · Product · Order · OrderItem
  seed.mjs                  Demo data
```

**Key decisions**
- **Server Components + Server Actions** for all data flow — no client API layer.
- **Inventory is enforced server-side** inside a Prisma transaction, so the cart
  UI can never oversell even if tampered with.
- **Prices are recomputed on the server** from the DB at checkout (never trusted
  from the client).
- **Food-forward design system** (cream paper, brand accent, Fraunces display +
  Inter) lives in `app/globals.css` as Tailwind v4 `@theme` tokens — deliberately
  *not* generic SaaS blue.
- Product imagery uses **emoji** to stay visual without an image-hosting
  dependency for the MVP.

## Payments (Stripe Connect)

DropQ uses **Stripe Connect** so each vendor gets paid directly, and DropQ keeps a
small platform fee per transaction (a **destination charge** with an
`application_fee_amount`).

**Demo mode (default):** with no Stripe keys set, checkout completes instantly with
no real charge — great for trying the app. The Payments page shows a "Demo mode"
notice.

**Turn on real payments:**
1. Create a [Stripe](https://dashboard.stripe.com) account and enable **Connect**
   (test mode is fine).
2. Put your keys in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...     # from `stripe listen` or the dashboard
   DROPQ_FEE_PERCENT=5                 # platform fee — adjustable
   ```
3. Restart `npm run dev`.
4. As a seller: **Dashboard → Payments → Connect with Stripe** and complete the
   Express onboarding (use Stripe's test data). Once charges are enabled, your
   storefront checkout switches to real Stripe Checkout automatically.
5. For local webhooks (optional — the success page also finalizes orders):
   ```
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

**How the money flows:** buyer pays at Stripe Checkout → funds settle to the
vendor's connected account → DropQ automatically retains `DROPQ_FEE_PERCENT` as an
application fee. Orders are created as `pending` and only marked paid (and inventory
decremented) after Stripe confirms payment — via the webhook **and** an idempotent
check on the success page, so it works locally even without the Stripe CLI running.

Relevant code: [lib/stripe.ts](lib/stripe.ts), [lib/checkout.ts](lib/checkout.ts),
[lib/actions/stripe.ts](lib/actions/stripe.ts),
[lib/actions/order.ts](lib/actions/order.ts),
[app/api/stripe/webhook/route.ts](app/api/stripe/webhook/route.ts),
[app/dashboard/payments/](app/dashboard/payments/).

## Notes / next steps
- **Auth** is email/password with signed httpOnly cookie sessions, plus **email
  verification** and **password reset**. Emails send via **Resend** (free tier) when
  `RESEND_API_KEY` is set; otherwise links print to the server console (dev mode), so
  the flows work with no paid services. Set `EMAIL_FROM` to a verified Resend domain
  for production. (Sessions aren't invalidated on password reset yet.)
- Image uploads use **Vercel Blob** in production (when `BLOB_READ_WRITE_TOKEN` is
  set) and fall back to `/public/uploads` locally — see `lib/upload.ts`.
- The build runs `prisma db push` (no migration history yet); formalize with
  `prisma migrate` once the schema settles.
- Natural extensions: refunds, SMS "drop is live" blasts, scheduled drop
  open/close, and AI demand-forecasting (teased in Analytics).
