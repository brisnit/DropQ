# Browser tests

Real-browser verification of the vendor experience. It has found defects that
the unit suites, TypeScript and `npm run build` all passed clean — a restart
button that did nothing, a "Skip for now" with no way back, bubbles positioned
from a stale measurement, guidance pointing at controls below the fold.

```bash
npm run test:browser              # every spec
npm run test:browser:guidance     # onboarding + contextual guidance
npm run test:browser:help         # the Help Center
npm run test:browser -- --fresh-db   # discard the throwaway database first
BROWSER_VERBOSE=1 npm run test:browser   # show the app's server log
```

## Don't run `npm run dev` at the same time

The harness starts its own app on port 3123. A dev server already running on
3000 doesn't collide on the port — it competes for CPU, and the harness gives up
with `app did not start on http://localhost:3123` after 60s. Stop the dev server
first.

## Production safety

**This suite creates and deletes vendors, drops and orders.** Three independent
guards make it impossible to point at anything else:

1. **A dedicated database.** `tests/browser/support/guard.mjs` pins the exact
   host, port and database name (`localhost:55432/dropq_browser_test`) that the
   harness itself creates. A URL that is merely "localhost" — your own dev
   database, say — is refused just as firmly as a production one.
2. **Every seed helper checks.** `assertVerifyDatabase()` runs before any
   `PrismaClient` is constructed in `seed/vendor.mjs`, so a spec cannot reach
   the database without passing the guard.
3. **The app is started with an explicit `DATABASE_URL`.** The dev server the
   suite launches cannot inherit one from `.env`, which in this repo points at
   production.

`NODE_ENV=production` is refused outright.

The fixture vendor is invented, and every address is on `example.com`, which is
reserved by RFC 2606 and cannot reach a person. No production data is read.

## How it runs

`run.mjs` boots a throwaway PostgreSQL cluster (a real server, via
`embedded-postgres`, under `tests/browser/.pgdata`), pushes the schema into it,
starts the app on port 3123 against it, runs each spec, then tears everything
down.

`STRIPE_SECRET_KEY` is set to a dummy on purpose. With an empty key
`isVendorSellable()` short-circuits to "everyone can sell" (see the local-dev
trap in the root README) and half the guidance under test becomes unreachable.

Chrome is driven through Playwright's `channel: "chrome"`, so nothing is
downloaded — it uses the browser already installed.

## Two things that will cost you an hour if you don't know them

**Use `localhost`, never `127.0.0.1`.** Served over a bare-IP origin the Next
dev client runtime never finishes starting: pages render, every request returns
200, nothing is logged — and React simply never hydrates, so no button works
and no key handler is attached. It presents as "the app is broken".

**`networkidle` does not mean hydrated.** Keyboard handlers are attached by an
effect. Use `guidanceReady(page, role)` before pressing keys, and prefer
`locator.press()` over `page.keyboard.press()` — it focuses the element first.

## Layout

```
tests/browser/
  run.mjs              orchestrator: database → schema → app → specs → teardown
  support/guard.mjs    the production-safety guard, and the shared constants
  support/database.mjs the throwaway PostgreSQL cluster
  support/session.mjs  mints the signed vendor cookie (no login form needed)
  support/browser.mjs  contexts, viewports, screenshots, assertion recorder
  seed/vendor.mjs      deterministic fixture states (fresh / selling)
  specs/*.spec.mjs     one file per area
  .pgdata/  .shots/    gitignored, disposable
```

Viewports are fixed at **390×844** and **1280×900** rather than device presets,
so "mobile" cannot quietly change meaning with a Playwright upgrade.

## Adding a spec

Create `specs/<area>.spec.mjs`, import the support helpers, use `recorder()`,
and `process.exit(ok ? 0 : 1)`. The runner picks it up automatically and
`npm run test:browser -- <area>` will filter to it.

## Help screenshots (`tests/browser/docs/`)

The illustrated Help articles are generated, not hand-taken.

```
npm run help:screenshots        # regenerate every image + the manifest
npm run help:screenshots:check  # fast: are the files present and referenced?
```

`docs/shots.mjs` is the list — one entry per image, naming the article it
belongs to, the scene, the route, what to highlight and the caption.
`docs/capture.mjs` runs them against the same isolated stack the specs use, with
the same three-layer production guard, and writes `public/help/<article>/<id>.png`
plus `public/help/manifest.json`. The app imports that manifest, so an article
can only show an image that was actually captured.

Three scenes, seeded by `seed/docs-vendor.mjs` — Cedar & Salt, a fictional
bakery on `example.com` addresses:

| scene | what it is |
|-------|------------|
| `new` | first minutes: no Stripe, no drops, checklist at 1 of 5 |
| `draft` | a drop built but not published |
| `live` | the same drop published, shared, two orders on it |

Things that were learned the hard way and are now enforced in code:

- **Don't wipe `public/help/` before capturing.** The app imports the manifest;
  deleting it makes every page that mounts Help fail to compile, including the
  dashboard being photographed. Images are overwritten in place and stale ones
  swept afterwards.
- **The clock has to be real.** A drop's phase is derived from `Date.now()`, so
  a fixed fictional date renders every drop as "Scheduled" no matter what state
  it is in. `DOCS_NOW` is today at 9am Pacific; scenes set dates relative to it.
- **Target controls by role, not by text.** `getByText("Connect with Stripe")`
  finds the sentence *about* the button first.
- **Scroll with `behavior: "instant"`.** The app sets `scroll-behavior: smooth`,
  so a highlight measured straight after `scrollIntoView` is drawn where the
  element used to be. There are guards for both off-screen highlights and
  highlights that cover more than 55% of the frame.

Known limitation: the **QR code images encode the local capture origin**, not
`drop-q.com`. The share link text is rewritten (`rewrites: ["origin"]` in the
manifest) but the QR is a server-rendered PNG built from the request's Host
header. It is illustrative only — don't scan it.

After any UI change to a documented screen, regenerate and *look at the images*.
`--check` proves they exist; only your eyes prove they are still true.
