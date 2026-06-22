import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { LinkButton, Eyebrow, Card, Badge } from "@/components/ui";

/* ----------------------------- Hero mockup ----------------------------- */
function DropMockup() {
  const items = [
    { emoji: "🍪", name: "Brown Butter Chocolate Chunk", price: "$18", left: 17, total: 40 },
    { emoji: "🥐", name: "Morning Bun", price: "$6.50", left: 6, total: 36 },
    { emoji: "🟤", name: "Miso Snickerdoodle", price: "$16", left: 11, total: 30 },
  ];
  return (
    <div className="relative">
      <div className="absolute -inset-6 hero-glow blur-2xl" aria-hidden />
      <Card className="relative p-0 overflow-hidden w-full max-w-sm mx-auto rotate-[0.6deg]">
        {/* storefront header */}
        <div className="bg-ink text-cream px-5 pt-5 pb-6">
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-semibold">Marble &amp; Crumb</span>
            <Badge className="bg-brand text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-white live-dot" /> Live
            </Badge>
          </div>
          <p className="text-cream/70 text-sm mt-1">Friday Cookie Drop · Pickup 4–6pm</p>
        </div>
        {/* items */}
        <div className="p-4 space-y-2.5">
          {items.map((it) => (
            <div
              key={it.name}
              className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
            >
              <span className="text-2xl">{it.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{it.name}</p>
                <p className="text-xs text-muted">{it.left} of {it.total} left</p>
              </div>
              <span className="text-sm font-semibold">{it.price}</span>
            </div>
          ))}
          <div className="flex items-center justify-between bg-brand text-white rounded-xl px-4 py-3 mt-1">
            <span className="text-sm font-medium">Checkout · 3 items</span>
            <span className="font-semibold">$40.50</span>
          </div>
        </div>
      </Card>
      {/* floating order toast */}
      <div className="absolute -bottom-4 -left-3 sm:-left-8 bg-paper border border-line rounded-2xl shadow-[var(--shadow-lift)] px-4 py-3 flex items-center gap-3 animate-in">
        <span className="w-9 h-9 rounded-full bg-sage-tint text-sage grid place-items-center text-lg">✓</span>
        <div>
          <p className="text-sm font-semibold">New order · $40.50</p>
          <p className="text-xs text-muted">Jordan just checked out</p>
        </div>
      </div>
    </div>
  );
}

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
    <section id={id} className={`max-w-6xl mx-auto px-5 ${className}`}>
      {children}
    </section>
  );
}

const SELL_CATEGORIES = [
  { emoji: "🍪", label: "Food & Beverage", eg: "Bakers, cottage food, popups" },
  { emoji: "🃏", label: "Collectibles", eg: "Cards, toys, antiques, vintage" },
  { emoji: "👕", label: "Apparel & Merch", eg: "Limited runs & branded merch" },
  { emoji: "🎨", label: "Art & Handmade", eg: "Prints, ceramics, makers" },
  { emoji: "✨", label: "& anything else", eg: "Hobby goods, oddities & more" },
];

const STEPS = [
  {
    n: "01",
    title: "Set up your store",
    body: "Add your name, your story, and how customers pick up or get delivery. Two minutes, no code.",
    emoji: "🏪",
  },
  {
    n: "02",
    title: "Build a drop",
    body: "List your products, set quantities, and pick when ordering opens and closes. Sell-outs handled automatically.",
    emoji: "🗓️",
  },
  {
    n: "03",
    title: "Share one link",
    body: "Drop it in your bio, stories, or a text blast. Your waitlist gets notified the moment you go live.",
    emoji: "🔗",
  },
  {
    n: "04",
    title: "Fulfill & get paid",
    body: "Orders land in one organized list. Mark them ready, hand them off, and watch revenue add up.",
    emoji: "💸",
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
    body: "Every order builds your customer list. Text your followers the second a drop goes live and bring them back week after week.",
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

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <SiteNav />

      {/* HERO */}
      <Section className="pt-16 pb-20 sm:pt-24 grid lg:grid-cols-2 gap-14 items-center">
        <div className="animate-in">
          <Badge className="bg-grey-tint text-[#3f434b] mb-5">
            Que the hype
          </Badge>
          <h1 className="font-display text-[2.6rem] sm:text-6xl leading-[1.02] font-semibold tracking-tight">
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
        <DropMockup />
      </Section>

      {/* SOCIAL PROOF STRIP */}
      <div className="border-y border-line bg-paper/60">
        <Section className="py-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 text-center">
          {[
            ["12,000+", "independent sellers"],
            ["$200M+", "sold through drops"],
            ["9 min", "to a typical sell-out"],
            ["4.9★", "seller rating"],
          ].map(([stat, label]) => (
            <div key={label} className="flex items-baseline gap-2">
              <span className="font-display text-xl font-semibold text-ink">{stat}</span>
              <span className="text-sm text-muted">{label}</span>
            </div>
          ))}
        </Section>
      </div>

      {/* CATEGORIES — DropQ is for every kind of seller */}
      <Section className="py-16 sm:py-20">
        <div className="max-w-2xl mx-auto text-center">
          <Eyebrow>For every kind of seller</Eyebrow>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Whatever you sell, drop it on DropQ.
          </h2>
          <p className="text-lg text-ink-soft mt-4">
            Food makers, collectors, designers, and artists all run timed drops and
            live sales on DropQ. Pick your category at signup and your store speaks
            your language.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-10">
          {SELL_CATEGORIES.map((c) => (
            <div key={c.label} className="bg-paper border border-line rounded-card p-5 text-center">
              <div className="text-4xl">{c.emoji}</div>
              <h3 className="font-semibold mt-3">{c.label}</h3>
              <p className="text-xs text-muted mt-1">{c.eg}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* PROBLEM */}
      <Section className="py-20 sm:py-28">
        <div className="max-w-3xl">
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
        </div>
        <div className="grid sm:grid-cols-3 gap-4 mt-10">
          {[
            ["😵‍💫", "Overselling & refunds", "No real inventory means promising stock you can't deliver."],
            ["💥", "Crashed links", "A story from a big account, and your ordering page buckles."],
            ["🫥", "Customers you lose", "No list, no way to bring last week's buyers back."],
          ].map(([emoji, t, b]) => (
            <Card key={t} className="p-6">
              <div className="text-3xl">{emoji}</div>
              <h3 className="font-semibold mt-3">{t}</h3>
              <p className="text-sm text-muted mt-1.5">{b}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <div className="bg-ink text-cream">
        <Section id="how" className="py-20 sm:py-28">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">
              How it works
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
              From idea to sold-out in one afternoon.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-12">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <div className="text-3xl">{s.emoji}</div>
                <div className="font-display text-sm text-grey mt-4">{s.n}</div>
                <h3 className="font-semibold text-lg mt-1">{s.title}</h3>
                <p className="text-sm text-cream/70 mt-2">{s.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12">
            <LinkButton href="/signup" variant="primary" size="lg">
              Build your first drop
            </LinkButton>
          </div>
        </Section>
      </div>

      {/* DROPS EXPLAINED */}
      <Section id="drops" className="py-20 sm:py-28 grid lg:grid-cols-2 gap-14 items-center">
        <div>
          <Eyebrow>What's a drop?</Eyebrow>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            Scarcity that sells out — on purpose.
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
                <span className="mt-0.5 w-5 h-5 rounded-full bg-sage-tint text-sage grid place-items-center text-xs shrink-0">✓</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <Card className="p-7">
          <div className="flex items-center justify-between mb-5">
            <span className="font-display text-lg font-semibold">This week's drop</span>
            <Badge className="bg-sage-tint text-sage">Open now</Badge>
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
                      className="h-full bg-brand rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </Section>

      {/* FEATURES GRID */}
      <div className="bg-paper border-y border-line">
        <Section id="features" className="py-20 sm:py-28">
          <div className="max-w-2xl">
            <Eyebrow>Everything in one place</Eyebrow>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
              One platform. The whole business.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-12">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-cream border border-line rounded-card p-6">
                <div className="text-3xl">{f.emoji}</div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-brand mt-4">
                  {f.tag}
                </span>
                <h3 className="font-semibold text-lg mt-1">{f.title}</h3>
                <p className="text-sm text-muted mt-2 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* TESTIMONIAL */}
      <Section id="stories" className="py-20 sm:py-28">
        <Card className="p-8 sm:p-14 text-center max-w-3xl mx-auto">
          <div className="text-grey text-2xl">★★★★★</div>
          <blockquote className="font-display text-2xl sm:text-3xl font-medium leading-snug mt-5">
            “DropQ turned my weekend hobby into a real business. I sold out my
            first drop in 11 minutes and finally have a customer list I own.”
          </blockquote>
          <div className="mt-7 flex items-center justify-center gap-3">
            <span className="w-11 h-11 rounded-full bg-brand-tint grid place-items-center text-xl">🃏</span>
            <div className="text-left">
              <p className="font-semibold">Matt Jennings</p>
              <p className="text-sm text-muted">Dope Collectables · La Mesa, CA</p>
            </div>
          </div>
        </Card>
      </Section>

      {/* PRICING TEASER */}
      <div className="bg-ink text-cream">
        <Section id="pricing" className="py-20 sm:py-28">
          <div className="max-w-2xl">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">
              Pricing
            </span>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
              Start free. Pay only when you sell.
            </h2>
            <p className="text-lg text-cream/70 mt-4">
              Try free on Starter, run unlimited drops on Growth, and keep a simple
              2% transaction fee at every tier. Cancel anytime.
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-5 mt-12">
            {[
              ["Starter", "$0", "/mo", "Try DropQ", ["3 drops to start", "Online ordering", "Pickup & delivery", "Customer list", "QR codes", "2% transaction fee"], false, false],
              ["Growth", "$20", "/mo", "Run Drops", ["Unlimited drops", "Customer signups (SMS + email)", "Sales analytics", "Repeat-customer tracking", "Shareable drop links", "2% transaction fee"], true, false],
              ["Pro", "$99", "/mo", "Grow Customers", ["Everything in Growth", "Advanced analytics", "Automated reminders", "Multiple locations & team", "Reduced 1.5% fee"], false, true],
            ].map(([name, price, per, position, feats, featured, soon]) => (
              <div
                key={String(name)}
                className={`rounded-card p-6 ${
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
            ))}
          </div>
          <div className="mt-8">
            <LinkButton href="/pricing" variant="secondary">See full pricing &amp; features →</LinkButton>
          </div>
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
