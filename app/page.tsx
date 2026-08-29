import Link from "next/link";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { LinkButton, Eyebrow, Card, Badge } from "@/components/ui";
import { Reveal } from "@/components/reveal";

/* ----------------------------- Hero mockup ----------------------------- */

/* ------------------------------- Sections ------------------------------ */
function Section({
  id,
  className = "",
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // `w-full` is load-bearing. These are flex items of `main.flex flex-col`,
    // and `mx-auto` sets an auto cross-axis margin, which DISABLES the default
    // `align-self: stretch`. The section then shrink-to-fits its max-content —
    // 370px against a 320px viewport, clipped rather than scrollable. An
    // explicit width restores stretch; `min-w-0` cannot help, because the item
    // was never being stretched in the first place.
    <section id={id} className={`w-full max-w-6xl mx-auto px-5 min-w-0 ${className}`}>
      {children}
    </section>
  );
}

const SELL_CATEGORIES = [
  { slug: "food", img: "/categories/food.png", label: "Food & Beverage", eg: "Bakers, cottage food, popups" },
  { slug: "collectibles", img: "/categories/collectibles.png", label: "Collectibles", eg: "Cards, toys, antiques, vintage" },
  { slug: "apparel", img: "/categories/apparel.png", label: "Apparel & Merch", eg: "Limited runs and branded merch" },
  { slug: "art", img: "/categories/art.png", label: "Art & Handmade", eg: "Prints, ceramics, makers" },
];

const STEPS = [
  {
    n: "01",
    title: "Set up your store",
    body: "Add your name, your story, and how customers pick up or get delivery. Two minutes, no code.",
    icon: "/categories/landing/icons/set-up-store.png",
  },
  {
    n: "02",
    title: "Build a drop",
    body: "List your products, set quantities, and pick when ordering opens and closes. Sell-outs handled automatically.",
    icon: "/categories/landing/icons/build-a-drop.png",
  },
  {
    n: "03",
    title: "Share one link",
    body: "Drop it in your bio, stories, or a text blast. Your waitlist gets notified the moment you go live.",
    icon: "/categories/landing/icons/share-one-link.png",
  },
  {
    n: "04",
    title: "Fulfill & get paid",
    body: "Orders land in one organized list. Mark them ready, hand them off, and watch revenue add up.",
    icon: "/categories/landing/icons/fulfill-get-paid.png",
  },
];

const FEATURES = [
  {
    tag: "Limited Drops",
    title: "Built for the way drops actually sell",
    body: "Limited inventory, timed windows, real scarcity. Set quantity per item and DropQ stops the sale at exactly the right moment — no overselling, no refunds, no crashed site when 500 people show up at once.",
    emoji: "🔥",
  },
  {
    tag: "Online Ordering",
    title: "A storefront that feels like you",
    body: "A clean, mobile-first ordering page with your name, your photos, your vibe. One link does everything — browse, order, pay.",
    emoji: "🛍️",
  },
  {
    tag: "Fulfillment",
    title: "Pickup or local delivery",
    body: "Offer pickup windows or local delivery zones. Every order shows exactly what, when, and where.",
    emoji: "📦",
  },
  {
    tag: "Customer Growth",
    title: "Turn one-time buyers into regulars",
    // "Text your followers" promised something DropQ doesn't do: following is
    // real in the schema but there is no vendor-facing follower list, count or
    // message audience — broadcasts resolve from orders (lib/messaging.ts
    // resolveAudience). Messaging past buyers about a new drop is real, so
    // that is what this now says.
    body: "Every order builds your customer list. Message your customers the moment a new drop is live and bring them back week after week.",
    emoji: "📣",
  },
  {
    tag: "Analytics",
    title: "Know what's working",
    body: "Best-sellers, repeat customers, revenue per drop. Clear numbers that tell you what to make more of.",
    emoji: "📈",
  },
  {
    tag: "One platform",
    title: "Replace the duct-tape stack",
    body: "No more link-in-bio + spreadsheet + Venmo + group text. One operating system that runs the whole business.",
    emoji: "🧩",
  },
];

// Each feature card cycles a palette accent so the grid uses coral, teal,
// yellow and grey rather than leaning on one color.
const FEATURE_ACCENTS = [
  { bar: "bg-brand", tag: "text-brand-dark", num: "text-brand/15" },
  { bar: "bg-tertiary", tag: "text-[#067b7d]", num: "text-tertiary/20" },
  { bar: "bg-quad", tag: "text-[#9a7400]", num: "text-quad/25" },
  { bar: "bg-secondary", tag: "text-secondary", num: "text-secondary/25" },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteNav />

      {/* HERO */}
      <Section className="pt-16 pb-20 sm:pt-24 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
        {/* min-w-0: grid items default to min-width:auto, so the hero column
            sized to the headline's min-content and ran 50px past a 320px
            viewport — clipped, not scrollable. */}
        <div className="animate-in min-w-0">
          <p className="text-lg sm:text-xl font-semibold text-brand mb-5">
            Queue the hype
          </p>
          <h1 className="font-display text-[clamp(1.9rem,8.2vw,2.6rem)] sm:text-6xl leading-[1.02] font-semibold tracking-tight">
            Organized Drops.
            <br />
            <span className="text-brand">Happy Customers.</span>
          </h1>
          <p className="mt-6 text-lg text-ink-soft max-w-lg">
            Run timed drops, take orders, manage pickup &amp; local delivery,
            and grow a loyal customer base — whether you sell food, collectibles,
            apparel, art, or anything in between.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton href="/signup" size="lg">
              Start selling — it's free
            </LinkButton>
            <LinkButton href="/s/marble-crumb" variant="secondary" size="lg">
              See a live store →
            </LinkButton>
          </div>
          <p className="mt-4 text-sm text-muted">
            No monthly fee to start · Set up in minutes · Cancel anytime
          </p>
        </div>
        {/* Hero video.
            Autoplaying muted is the only way a browser starts this without a
            click, so the source's AAC track is silent here by design.
            `playsInline` stops iOS hijacking it into fullscreen.

            The poster is painted on the FRAME as a background, not just on the
            <video>: that way `prefers-reduced-motion` can drop the video
            element entirely and the still frame is already behind it, rather
            than leaving a hole where the column used to be. */}
        <div className="relative animate-in min-w-0">
          {/* Bleeds vertically only. The old mockup card was `max-w-sm`, so a
              symmetric -inset-6 stayed on screen; the video frame is full-width
              on a phone, where the same glow put its box 24px past both edges. */}
          <div className="absolute -inset-y-6 inset-x-0 hero-glow blur-2xl" aria-hidden />
          <div
            className="relative w-full aspect-video lg:aspect-[5/4] rounded-card border border-line shadow-[var(--shadow-lift)] overflow-hidden bg-line bg-cover bg-center"
            style={{ backgroundImage: "url('/hero/hero-poster.jpg')" }}
            role="img"
            aria-label="A baker laying out trays of fresh cookies in a sunlit kitchen"
          >
            <video
              className="hero-video w-full h-full object-cover"
              poster="/hero/hero-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden
              tabIndex={-1}
            >
              <source src="/hero/hero.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      </Section>

      {/* CATEGORIES — DropQ is for every kind of seller */}
      <Section id="sell" className="pt-16 pb-6 sm:pt-20 sm:pb-10 scroll-mt-24">
        <Reveal className="max-w-2xl mx-auto text-center">
          <Eyebrow>For every kind of seller</Eyebrow>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Whatever you sell, drop it on DropQ.
          </h2>
          <p className="text-lg text-ink-soft mt-4">
            Food makers, collectors, designers, and artists all run timed drops and
            live sales on DropQ. Pick your category at signup and your store speaks
            your language.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 mt-20">
          {SELL_CATEGORIES.map((c, i) => (
            <Reveal key={c.label} delay={i * 80}>
              <Link
                href={`/sell/${c.slug}`}
                className="group block bg-paper border border-line rounded-card overflow-hidden shadow-[var(--shadow-soft)] transition-all duration-300 ease-out hover:-translate-y-1.5 hover:shadow-[var(--shadow-lift)]"
              >
                <div className="aspect-[5/4] overflow-hidden bg-cream">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.img}
                    alt={c.label}
                    className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                </div>
                <div className="p-4">
                  <h3 className="font-semibold transition-colors group-hover:text-brand">{c.label}</h3>
                  <p className="text-xs text-muted mt-1">{c.eg}</p>
                </div>
              </Link>
            </Reveal>
          ))}

          {/* And everything else — spans two columns. The card fills the row
              height (set by the single card beside it) and its image fills the
              space above a footer identical to the others, so every white
              footer lines up at the same height. basis-0 stops the image's
              intrinsic size from inflating the row. */}
          <Reveal delay={SELL_CATEGORIES.length * 80} className="sm:col-span-2">
            <Link
              href="/sell/everything"
              className="group h-full flex flex-col bg-paper border border-line rounded-card overflow-hidden shadow-[var(--shadow-soft)] transition-all duration-300 ease-out hover:-translate-y-1.5 hover:shadow-[var(--shadow-lift)]"
            >
              <div className="flex-1 basis-0 min-h-0 overflow-hidden bg-cream">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/categories/everything.png"
                  alt="And everything else"
                  className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                />
              </div>
              <div className="p-4">
                <h3 className="font-semibold transition-colors group-hover:text-brand">And everything else…</h3>
                <p className="text-xs text-ink underline underline-offset-2 mt-1">
                  Sell whatever you sell in drops
                </p>
              </div>
            </Link>
          </Reveal>
        </div>
      </Section>

      {/* PROBLEM */}
      <Section className="py-20 sm:py-28">
        <Reveal className="max-w-3xl">
          <Eyebrow>The problem</Eyebrow>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Your business runs on a dozen apps that don't talk to each other.
          </h2>
          <p className="text-lg text-ink-soft mt-5">
            Instagram for marketing. Link-in-bio for the catalog. A spreadsheet for
            orders. Venmo for payment. A group text for the waitlist. Sticky
            notes for the rest. It works — until a drop goes viral and the whole
            thing falls apart at the worst possible moment.
          </p>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-10">
          {[
            ["😵‍💫", "Overselling & refunds", "No real inventory means promising stock you can't deliver."],
            ["💥", "Crashed links", "A story from a big account, and your ordering page buckles."],
            ["🫥", "Customers you lose", "No list, no way to bring last week's buyers back."],
          ].map(([emoji, t, b], i) => (
            <Reveal key={t} delay={i * 80}>
              <Card className="p-6 h-full">
                <div className="text-3xl">{emoji}</div>
                <h3 className="font-semibold mt-3">{t}</h3>
                <p className="text-sm text-muted mt-1.5">{b}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <div className="bg-ink text-cream">
        <Section id="how" className="py-20 sm:py-28">
          <Reveal className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">
              How it works
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
              From idea to sold-out in one afternoon.
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-12">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.icon} alt="" className="w-9 h-9 object-contain" />
                <div className="font-display text-sm text-grey mt-4">{s.n}</div>
                <h3 className="font-semibold text-lg mt-1">{s.title}</h3>
                <p className="text-sm text-cream/70 mt-2">{s.body}</p>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-12">
            <LinkButton href="/signup" variant="brand" size="lg">
              Build your first drop
            </LinkButton>
          </Reveal>
        </Section>
      </div>

      {/* DROPS EXPLAINED */}
      <Section id="drops" className="py-20 sm:py-28 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
        <Reveal>
          <Eyebrow>What's a drop?</Eyebrow>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Scarcity that sells out on purpose.
          </h2>
          <p className="text-lg text-ink-soft mt-5">
            A drop is a limited release, available for a set window. You decide what
            you're offering, how many, and when ordering opens. Customers feel the
            urgency. You sell to exact demand with nothing left on the table.
          </p>
          <ul className="mt-6 space-y-3">
            {[
              "Set quantity per item — we stop the sale at sold-out",
              "Open and close ordering on a schedule",
              "A waitlist that gets notified the instant you go live",
              "Handles big traffic spikes without breaking a sweat",
            ].map((t) => (
              <li key={t} className="flex gap-3 text-ink-soft">
                <span className="mt-0.5 w-5 h-5 rounded-full bg-brand-tint text-brand-dark grid place-items-center text-xs shrink-0">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={120}>
        <Card className="p-7">
          <div className="flex items-center justify-between mb-5">
            <span className="font-display text-lg font-semibold">This week's drop</span>
            <Badge className="bg-brand-tint text-brand-dark">Open now</Badge>
          </div>
          <div className="space-y-3">
            {[
              ["1st-Edition Holo Card", 23, 40],
              ["Resin Art Print — A2", 19, 30],
              ["Hand-thrown Ceramic Mug", 30, 36],
            ].map(([name, sold, total]) => {
              const pct = Math.round((Number(sold) / Number(total)) * 100);
              return (
                <div key={String(name)}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted">{sold}/{total} sold</span>
                  </div>
                  <div className="h-2 rounded-full bg-line overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: "#1faa6b" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        </Reveal>
      </Section>

      {/* FEATURES GRID */}
      <div className="bg-paper border-y border-line">
        <Section id="features" className="py-20 sm:py-28">
          <Reveal className="max-w-2xl">
            <Eyebrow>Everything in one place</Eyebrow>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
              One platform. The whole business.
            </h2>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
            {FEATURES.map((f, i) => {
              const acc = FEATURE_ACCENTS[i % FEATURE_ACCENTS.length];
              return (
                <Reveal key={f.title} delay={(i % 3) * 80}>
                  <div className="group relative h-full overflow-hidden bg-paper border border-line rounded-card p-6 shadow-[var(--shadow-soft)] transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
                    <span
                      className={`pointer-events-none select-none absolute -top-1 right-3 font-display text-6xl font-bold leading-none ${acc.num}`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className={`w-10 h-1.5 rounded-full ${acc.bar}`} />
                    <span className={`block text-xs font-semibold uppercase tracking-wider mt-5 ${acc.tag}`}>
                      {f.tag}
                    </span>
                    <h3 className="font-semibold text-lg mt-1">{f.title}</h3>
                    <p className="text-sm text-muted mt-2 leading-relaxed">{f.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </Section>
      </div>

      {/* DROPMEET — the community/discovery layer */}
      <div className="bg-tertiary-tint/50 border-b border-line">
        <Section id="dropmeet" className="py-20 sm:py-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <Reveal>
              <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-tertiary">
                <span className="w-1.5 h-1.5 rounded-full bg-tertiary" aria-hidden />
                New · San Diego County
              </span>
              <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
                DropMeet: the map of local commerce.
              </h2>
              <p className="text-lg text-ink-soft mt-5">
                Discover local markets, vendors, drops, and gathering places. Farmers markets, flea
                markets, vintage and makers markets, breweries, food halls — every place where small
                sellers actually show up.
              </p>
              <p className="text-ink-soft mt-4">
                Selling well shouldn&apos;t mean going it alone. DropMeet exists to build the drop
                community: connect the places people already gather with the makers selling there,
                so a customer can find a market, see who&apos;s attending, and preorder before they
                arrive.
              </p>

              <div className="flex flex-wrap gap-3 mt-8">
                <LinkButton href="/dropmeet" variant="tertiary" size="lg">
                  Explore DropMeet
                </LinkButton>
                <LinkButton href="/dropmeet/add" variant="primary" size="lg">
                  Add a place
                </LinkButton>
              </div>
              <p className="text-sm text-muted mt-4">
                Starting in San Diego County. Know a market we&apos;re missing? Add it — our team
                reviews every submission.
              </p>
            </Reveal>

            {/* The product thesis, as three beats */}
            <div className="space-y-4">
              {[
                [
                  "📍",
                  "Where people gather",
                  "Markets, breweries, churches, parks, pop-ups — the real places local commerce happens.",
                ],
                [
                  "🧑‍🍳",
                  "Who's selling there",
                  "See which DropQ vendors are attending, on which day, at which booth.",
                ],
                [
                  "🛍️",
                  "What you can preorder",
                  "Reserve from a vendor's drop before you go, then pick it up when you arrive.",
                ],
              ].map(([emoji, title, body], i) => (
                <Reveal key={title} delay={i * 90}>
                  <div className="flex items-start gap-4 bg-paper border border-line rounded-card p-5 shadow-[var(--shadow-soft)]">
                    <div className="text-2xl shrink-0" aria-hidden>
                      {emoji}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold">{title}</h3>
                      <p className="text-sm text-muted mt-1 leading-relaxed">{body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}

              <Reveal delay={270}>
                <p className="text-sm text-ink-soft text-center pt-2">
                  Every market brings vendors. Every vendor runs drops. Every drop brings customers
                  — who find the next market.
                </p>
              </Reveal>
            </div>
          </div>
        </Section>
      </div>

      {/* TESTIMONIAL */}
      <Section id="stories" className="py-20 sm:py-28">
        <Reveal>
        <div
          className="p-8 sm:p-14 text-center max-w-3xl mx-auto border border-line rounded-card shadow-[var(--shadow-soft)]"
          style={{ backgroundColor: "#ececed" }}
        >
          <div className="text-grey text-2xl">★★★★★</div>
          <blockquote className="font-display text-2xl sm:text-3xl font-medium leading-snug mt-5">
            “DropQ turned my weekend hobby into a real business. I sold out my
            first drop in 11 minutes and finally have a customer list I own.”
          </blockquote>
          <div className="mt-7 text-center">
            <p className="font-semibold">Matt Jennings</p>
            <p className="text-sm text-muted">Dope Collectables · La Mesa, CA</p>
          </div>
        </div>
        </Reveal>
      </Section>

      {/* PRICING TEASER */}
      <div className="bg-ink text-cream">
        <Section id="pricing" className="py-20 sm:py-28">
          <Reveal className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">
              Pricing
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
              Start free. Pay only when you sell.
            </h2>
            <p className="text-lg text-cream/70 mt-4">
              Try free, run unlimited drops on Basic, and keep a simple
              2% transaction fee at every tier. Cancel anytime.
            </p>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mt-12">
            {[
              ["Free", "$0", "/mo", "Try DropQ", ["3 drops to start", "Online ordering", "Pickup & delivery", "Customer list", "QR codes", "2% transaction fee"], false, false],
              ["Basic", "$8", "/mo", "Run Drops", ["Unlimited drops", "Customer signups (SMS + email)", "Sales analytics", "Repeat-customer tracking", "Shareable drop links", "2% transaction fee"], true, false],
              ["Pro", "$14", "/mo", "Grow Customers", ["Everything in Basic", "Reduced 1.5% fee", "Advanced analytics", "Automated reminders", "Data exports"], false, true],
            ].map(([name, price, per, position, feats, featured, soon], i) => (
              <Reveal key={String(name)} delay={i * 90}>
              <div
                className={`rounded-card p-6 h-full ${
                  featured
                    ? "bg-brand text-white ring-2 ring-grey"
                    : "bg-cream/5 border border-cream/15"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${featured ? "text-white/80" : "text-grey"}`}>{String(position)}</span>
                  {featured ? <Badge className="bg-grey text-white">Most popular</Badge> : null}
                  {soon ? <Badge className="bg-cream/15 text-cream">Coming soon</Badge> : null}
                </div>
                <h3 className="font-semibold text-lg">{String(name)}</h3>
                <div className="mt-2 mb-5">
                  <span className="font-display text-4xl font-semibold">{String(price)}</span>
                  <span className={featured ? "text-white/80" : "text-cream/60"}>{String(per)}</span>
                </div>
                <ul className="space-y-2 text-sm">
                  {(feats as string[]).map((ft) => (
                    <li key={ft} className="flex gap-2">
                      <span className={featured ? "text-white" : "text-grey"}>✓</span>
                      <span className={featured ? "text-white/90" : "text-cream/75"}>{ft}</span>
                    </li>
                  ))}
                </ul>
              </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8">
            <LinkButton href="/pricing" variant="secondary">See full pricing &amp; features →</LinkButton>
          </Reveal>
        </Section>
      </div>

      {/* FINAL CTA */}
      <Section className="py-24 text-center">
        <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight max-w-2xl mx-auto">
          Your next drop is waiting.
        </h2>
        <p className="text-lg text-ink-soft mt-5 max-w-xl mx-auto">
          Join thousands of independent sellers running a real business from one
          beautiful platform. Free to start.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <LinkButton href="/signup" size="lg">
            Start your store
          </LinkButton>
          <LinkButton href="/login" variant="secondary" size="lg">
            Log in
          </LinkButton>
        </div>
      </Section>

      <SiteFooter />
    </main>
  );
}
