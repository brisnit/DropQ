import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { LinkButton } from "@/components/ui";

export const metadata: Metadata = {
  title: "About DropQ — You make it. We help you drop it.",
  description:
    "DropQ helps independent sellers turn what they offer into organized drops, and gives customers one simple place to order.",
};

/**
 * The About page, linked from the footer.
 *
 * Long-form and single column on purpose. This is the page someone reads when
 * they are deciding whether to trust us with their business, so it is set like
 * something written rather than something marketed: one measure of text, real
 * paragraphs, two photographs, and the eye never asked to choose between
 * columns.
 */

/** A section heading, in the page's one voice. */
function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-14 sm:mt-20">
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-soft mt-4 leading-relaxed">{children}</p>;
}

export default function AboutPage() {
  return (
    <>
      <SiteNav />
      <main className="bg-cream text-ink">
        <article className="max-w-2xl mx-auto px-5 py-14 sm:py-20">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              About DropQ
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight leading-[1.08] mt-3">
              You make it.
              <br />
              We help you drop it.
            </h1>
            <p className="text-lg text-ink-soft mt-6 leading-relaxed">
              For the baker with a weekend menu. The collector with something
              rare. The artist releasing a new print. The maker packing orders
              at the kitchen table.
            </p>
            <p className="text-lg text-ink-soft mt-4 leading-relaxed">
              DropQ helps independent sellers turn what they offer into
              organized drops — and gives customers one simple place to order.
            </p>
          </Reveal>

          <Reveal>
            <figure className="mt-12 sm:mt-16 -mx-5 sm:mx-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/about/small-batch-pastries.png"
                alt="Small-batch pastries packed in morning light."
                width={1536}
                height={1024}
                className="w-full h-auto sm:rounded-card border-y sm:border border-line"
              />
            </figure>
          </Reveal>

          <Reveal>
            <H2>Small businesses deserve less busywork.</H2>
            <P>
              Selling something you love should leave you time to keep doing it.
            </P>
            <P>
              But behind every release, there&apos;s work customers never see:
              posting availability, answering messages, counting inventory,
              collecting payments, and making sure everyone knows when and where
              to pick up.
            </P>
            <P>
              Spread that work across social posts, spreadsheets, payment links,
              and group texts, and a successful sale can become a complicated
              afternoon.
            </P>
            <P>We built DropQ to bring those pieces together.</P>
            <P>
              One storefront. Clear quantities. A window to order. An organized
              way to fulfill.
            </P>
            <P>
              So you can spend more time making, finding, creating, and
              connecting.
            </P>
          </Reveal>

          <Reveal>
            <H2>A drop is a moment worth showing up for.</H2>
            <P>A fresh batch. A limited run. A carefully picked collection.</P>
            <P>
              A drop gives customers a clear answer to three questions:
              What&apos;s available? When can I order? How do I get it?
            </P>
            <P>
              For sellers, it creates a manageable rhythm. You decide what to
              offer, how much is available, and when the sale happens.
            </P>
            <P>
              For customers, it makes supporting an independent business easy —
              from discovering something new to coming back for a favorite.
            </P>
          </Reveal>

          <Reveal>
            <H2>Built for the people behind the products.</H2>
            <P>
              You don&apos;t need a big team to take your business seriously.
            </P>
            <P>
              DropQ brings together the everyday tools that help a small
              operation run well:
            </P>
            <ul className="mt-5 space-y-4">
              {[
                ["An easy place to order.", "Share a storefront or drop link wherever your customers already follow you."],
                ["Inventory you can keep track of.", "Set quantities so customers know what's still available."],
                ["Clear pickup and local delivery details.", "Help every order get where it needs to go."],
                ["Customer relationships that can grow.", "Keep track of buyers and give them a reason to return."],
              ].map(([lead, rest]) => (
                <li key={lead} className="flex gap-3">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden />
                  <span className="text-ink-soft leading-relaxed">
                    <span className="font-medium text-ink">{lead}</span> {rest}
                  </span>
                </li>
              ))}
            </ul>
            <P>
              Whether you sell food, collectibles, apparel, art, handmade goods,
              or something entirely your own, there&apos;s room for you here.
            </P>
          </Reveal>

          <Reveal>
            <figure className="mt-12 sm:mt-16 -mx-5 sm:mx-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/about/makers-market.png"
                alt="Friendly chat at a makers market."
                width={1536}
                height={1024}
                className="w-full h-auto sm:rounded-card border-y sm:border border-line"
              />
            </figure>
          </Reveal>

          <Reveal>
            <H2>Starting local. Building connections.</H2>
            <P>
              Our local discovery effort starts in San Diego County, where
              markets, pop-ups, and neighborhood gathering places bring
              independent businesses to life.
            </P>
            <P>
              With DropMeet, we&apos;re building a way to connect those places
              with the vendors selling there — and the drops customers can order
              before they arrive.
            </P>
            <P>
              Because discovering a great seller shouldn&apos;t be a one-time
              lucky find. It should be the beginning of a relationship.
            </P>
            <p className="mt-5">
              <Link
                href="/dropmeet"
                className="inline-flex items-center min-h-11 font-medium text-brand hover:text-brand-dark underline underline-offset-4"
              >
                Explore DropMeet →
              </Link>
            </p>
          </Reveal>

          <Reveal>
            <H2>What matters to us.</H2>
            <dl className="mt-5 space-y-6">
              {[
                ["Your business should feel like yours.", "Your name, your products, your story. DropQ helps you present them clearly."],
                ["Useful beats complicated.", "A seller should be able to set up a drop, share it, and get on with their day."],
                ["Small beginnings count.", "A first batch or first collection deserves a good experience, too."],
                ["Relationships make businesses stronger.", "We want to help customers find you, order with confidence, and come back."],
              ].map(([term, def]) => (
                <div key={term}>
                  <dt className="font-semibold">{term}</dt>
                  <dd className="text-ink-soft mt-1 leading-relaxed">{def}</dd>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal>
            <div className="mt-16 sm:mt-20 rounded-card border border-line bg-paper p-6 sm:p-10 text-center">
              <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
                Make your next drop happen.
              </h2>
              <p className="text-ink-soft mt-3 max-w-md mx-auto leading-relaxed">
                Start with what you have. Give it a place to sell. Share it with
                your people. We&apos;ll help you keep it organized.
              </p>
              <div className="mt-7 flex flex-col sm:flex-row gap-3 sm:justify-center">
                <LinkButton href="/signup" size="lg" className="w-full sm:w-auto justify-center">
                  Start selling free →
                </LinkButton>
                <LinkButton
                  href="/dropmeet"
                  variant="ghost"
                  size="lg"
                  className="w-full sm:w-auto justify-center border border-line-strong"
                >
                  Explore DropMeet →
                </LinkButton>
              </div>
            </div>
          </Reveal>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
