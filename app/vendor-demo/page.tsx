import type { Metadata } from "next";
import { LinkButton } from "@/components/ui";
import { Logo } from "@/components/logo";
import { Reveal } from "@/components/reveal";
import {
  VendorDemoStorefrontPreview,
  VendorDemoWalkthrough,
} from "@/components/vendor-demo/walkthrough";
import { VendorDemoStickyCta } from "@/components/vendor-demo/sticky-cta";
import { DEMO_AUDIENCE, DEMO_MODEL } from "@/lib/vendor-demo";

/**
 * The unlisted vendor demo — the page behind the QR code we hand someone at a
 * farmers market.
 *
 * ── THE SITUATION IT IS BUILT FOR ─────────────────────────────────────────
 *
 * A baker is standing at their stall with one hand free. They have sixty
 * seconds and no particular reason to trust us. Every decision here follows
 * from that: phone-first at 375px, one thumb, short lines, no typing, and the
 * product doing the talking instead of adjectives.
 *
 * ── UNLISTED, NOT SECRET ──────────────────────────────────────────────────
 *
 * `robots: noindex` and no link from any navigation, so it is reachable only
 * by the people we give it to. That is not a security boundary — it is
 * public, unauthenticated and contains nothing private. It shows invented
 * businesses and invented buyers (see lib/vendor-demo.ts) precisely so that
 * being public costs nothing.
 *
 * ── WHAT IT MUST NOT DO ───────────────────────────────────────────────────
 *
 * Create an account, write a row, call Stripe, or touch the real onboarding.
 * The walkthrough is client state only. A stranger can tap every control and
 * production will not notice.
 */
export const metadata: Metadata = {
  title: "See DropQ in 60 seconds",
  description:
    "A short, tappable walkthrough of DropQ for local makers — set up a store, connect Stripe, build a drop, and see what your customers get.",
  robots: { index: false, follow: false, nocache: true },
};

export default function VendorDemoPage() {
  return (
    <main className="bg-cream text-ink">
      {/* ------------------------------------------------------- hero ---- */}
      <section className="px-5 pt-8 pb-12 sm:pt-14 max-w-5xl mx-auto">
        {/* Padded to a 44px target: the shared Logo renders a 24px image, which
            is fine in a desktop header and not fine on a page held one-handed. */}
        <div className="[&_a]:min-h-11 [&_a]:py-2.5 [&_a]:-my-2.5">
          <Logo href="/" />
        </div>

        <div className="mt-10 sm:mt-14 lg:grid lg:grid-cols-2 lg:gap-12 lg:items-center">
          <div className="lg:max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              For local makers
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.05] mt-3">
              Sell what you make.
              <br />
              Drop it when you&apos;re ready.
            </h1>
            <p className="text-lg text-ink-soft mt-5 max-w-prose">
              DropQ gives you a simple way to launch limited drops, take card
              payments, and keep every order in one place — without running an
              online store.
            </p>

            {/* Thumb-height, full width on a phone: this is tapped standing up. */}
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <LinkButton href="#walkthrough" size="lg" className="w-full sm:w-auto justify-center">
                See how it works
              </LinkButton>
              <LinkButton
                href="/signup"
                variant="ghost"
                size="lg"
                className="w-full sm:w-auto justify-center border border-line-strong"
              >
                Start selling
              </LinkButton>
            </div>

            <p className="text-sm text-muted mt-4">
              Your first drop can be live in minutes.
            </p>
          </div>

          {/* On desktop the hero gets the product; on a phone the walkthrough
              below is already the product, so this would only add scroll. */}
          <div className="hidden lg:block relative">
            <div className="absolute -inset-6 hero-glow blur-2xl" aria-hidden />
            <div className="relative mx-auto max-w-[380px]">
              <VendorDemoStorefrontPreview />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------ the mental model ---- */}
      <section className="px-5 py-12 sm:py-16 bg-paper border-y border-line">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              The whole thing, in three steps
            </h2>
          </Reveal>

          <ol className="mt-7 grid gap-4 sm:grid-cols-3">
            {DEMO_MODEL.map((m, i) => (
              <Reveal key={m.n} delay={i * 90}>
                <li className="h-full rounded-card border border-line bg-cream p-5">
                  <span
                    className="inline-grid place-items-center w-9 h-9 rounded-full bg-ink text-cream font-display font-semibold tabular-nums"
                    aria-hidden
                  >
                    {m.n}
                  </span>
                  <h3 className="font-semibold text-lg mt-3">{m.title}</h3>
                  <p className="text-sm text-ink-soft mt-1.5">{m.body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* --------------------------------------------- the walkthrough ---- */}
      <section id="walkthrough" className="px-5 py-12 sm:py-16 scroll-mt-4">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center max-w-xl mx-auto">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              Try it before you sign up
            </h2>
            <p className="text-ink-soft mt-3">
              Tap through what a new vendor actually does. Nothing here is real
              and nothing is saved.
            </p>
          </Reveal>

          <VendorDemoWalkthrough />
        </div>
      </section>

      {/* -------------------------------------------- the "that's it" ---- */}
      <section className="px-5 py-14 sm:py-20 bg-ink text-cream">
        <div className="max-w-5xl mx-auto text-center">
          <Reveal>
            <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight">
              That&apos;s it.
            </h2>
            <p className="text-lg text-cream/80 mt-4 max-w-md mx-auto">
              Create your drop. Share the link. Make what sells.
            </p>
          </Reveal>

          <Reveal delay={120}>
            <ol className="mt-9 flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
              {["Make", "Drop", "Sell", "Repeat"].map((word, i) => (
                <li key={word} className="flex items-center gap-2 sm:gap-3">
                  <span className="rounded-pill border border-cream/25 px-4 py-2 text-sm font-semibold">
                    {word}
                  </span>
                  {i < 3 && <span className="text-cream/40" aria-hidden>→</span>}
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal delay={200}>
            <p className="text-cream/70 mt-9 max-w-lg mx-auto">
              No storefront to build. No guessing how much to make. No
              spreadsheet of who ordered what.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ----------------------------------------------- who it's for ---- */}
      <section className="px-5 py-12 sm:py-16">
        <div className="max-w-3xl mx-auto text-center">
          <Reveal>
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              Built for people who make things
            </h2>
          </Reveal>
          <Reveal delay={90}>
            <ul className="mt-6 flex flex-wrap justify-center gap-2">
              {DEMO_AUDIENCE.map((who) => (
                <li
                  key={who}
                  className="rounded-pill border border-line bg-paper px-4 py-2 text-sm text-ink-soft"
                >
                  {who}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ------------------------------------------------- final CTA ---- */}
      <section className="px-5 pb-28 sm:pb-24 pt-4">
        <div className="max-w-xl mx-auto text-center">
          <Reveal>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              Ready for your first drop?
            </h2>
            <p className="text-ink-soft mt-3">
              Set up your store, connect Stripe, and start selling.
            </p>
          </Reveal>

          <Reveal delay={90}>
            <div className="mt-7 flex flex-col gap-3">
              <LinkButton href="/signup" size="lg" className="w-full justify-center">
                Start selling on DropQ
              </LinkButton>
              <LinkButton
                href="#walkthrough"
                variant="ghost"
                size="lg"
                className="w-full justify-center border border-line-strong"
              >
                Show me again
              </LinkButton>
            </div>
            <p className="text-sm text-muted mt-4">
              Already a vendor?{" "}
              <a
                href="/login"
                className="inline-flex items-center min-h-11 px-2 -mx-2 text-ink font-medium underline underline-offset-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary/60"
              >
                Sign in
              </a>
            </p>
          </Reveal>
        </div>
      </section>

      {/* A CTA that follows them down the page. At a market the phone gets
          handed back mid-scroll, and the way to sign up should never be more
          than a thumb away — except while the demo is on screen, where it
          would cover the demo's own button. */}
      <VendorDemoStickyCta watch="walkthrough" />
    </main>
  );
}
