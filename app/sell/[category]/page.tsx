import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { LinkButton, Card } from "@/components/ui";
import { Reveal } from "@/components/reveal";

type Accent = "brand" | "tertiary" | "quad";

type Category = {
  label: string;
  eg: string;
  img: string;
  img2: string;
  accent: Accent;
  headline: string;
  sub: string;
  features: { title: string; body: string }[];
  bullets: string[];
};

const CATEGORIES: Record<string, Category> = {
  food: {
    label: "Food & Beverage",
    eg: "Bakers · cottage food · popups · meal prep",
    img: "/categories/landing/food-1.png",
    img2: "/categories/landing/food-2.png",
    accent: "brand",
    headline: "Sell out Friday's batch before the oven's even warm.",
    sub: "For bakers, cottage-food makers, popups, and meal-preppers who sell fresh, sell fast, and sell out every week.",
    features: [
      {
        title: "Timed pickup & delivery windows",
        body: "Open ordering Thursday night, close it once you're prepped. Customers pick a pickup slot — no DM back-and-forth, no missed handoffs.",
      },
      {
        title: "Real inventory on perishables",
        body: "Set exactly how many you're baking. DropQ stops the sale at sold-out so you never refund a croissant you can't make.",
      },
      {
        title: "A waitlist that fills your next drop",
        body: "Regulars get a text the second you go live. Last week's buyers come back without you lifting a finger.",
      },
    ],
    bullets: [
      "Cottage-food friendly — your kitchen, your rules",
      "Keep your sales minus a flat 2% — no marketplace commission",
      "Pickup, local delivery, or both — scheduled to the minute",
      "Your own branded storefront, not a crowded marketplace",
    ],
  },
  collectibles: {
    label: "Collectibles",
    eg: "Cards · toys · antiques · vintage",
    img: "/categories/landing/collectibles-1.png",
    img2: "/categories/landing/collectibles-2.png",
    accent: "tertiary",
    headline: "Drop your grails to a line that forms in seconds.",
    sub: "For card breakers, toy sellers, and vintage dealers moving hyped, one-of-a-kind inventory to buyers who move fast.",
    features: [
      {
        title: "True 1-of-1 stock locks",
        body: "List a single graded card and DropQ guarantees it sells once — no double-sells, no awkward refunds when two buyers tap at the same second.",
      },
      {
        title: "Built for hype spikes",
        body: "A repost from a big account won't crash your store. DropQ absorbs the rush so the fastest buyer wins, fairly.",
      },
      {
        title: "A buyer list you own",
        body: "Every collector who orders is yours to bring back for the next drop — never locked away inside someone else's marketplace.",
      },
    ],
    bullets: [
      "Scheduled drops build anticipation and urgency",
      "Flat 2% — keep more of every high-ticket sale",
      "Set quantities per item, down to the very last one",
      "Your brand front-and-center, not a sea of listings",
    ],
  },
  apparel: {
    label: "Apparel & Merch",
    eg: "Limited runs · branded merch · streetwear",
    img: "/categories/landing/apparel-1.png",
    img2: "/categories/landing/apparel-2.png",
    accent: "quad",
    headline: "Limited runs that actually sell out.",
    sub: "For streetwear labels, bands, and creators dropping merch in timed, finite releases that move on their own schedule.",
    features: [
      {
        title: "Quantity caps that create scarcity",
        body: "Set the run size and let it sell out. Scarcity does the marketing for you, and a sold-out badge does the bragging.",
      },
      {
        title: "Pre-order & restock windows",
        body: "Open a window, take orders, close it, and produce to exact demand — no dead stock sitting in a closet.",
      },
      {
        title: "Restock waitlists",
        body: "Sold out? Collect signups and notify everyone the instant the next run drops. Demand, captured.",
      },
    ],
    bullets: [
      "Run drops on your schedule, not a marketplace's",
      "Flat 2% transaction fee, no listing fees",
      "One shareable link for every release",
      "A storefront that looks like your brand, head to toe",
    ],
  },
  art: {
    label: "Art & Handmade",
    eg: "Prints · ceramics · makers · originals",
    img: "/categories/landing/art-1.png",
    img2: "/categories/landing/art-2.png",
    accent: "brand",
    headline: "One-of-a-kind work, sold the moment you publish.",
    sub: "For artists, ceramicists, and makers selling originals, small editions, and handmade goods to people who collect them.",
    features: [
      {
        title: "Originals & limited editions",
        body: "Sell a true 1/1 or a numbered edition — DropQ tracks every piece so nothing oversells and every buyer gets what they paid for.",
      },
      {
        title: "Drops that respect your pace",
        body: "Open ordering when a batch is ready, close it when you need to make more. No pressure to overproduce on someone else's clock.",
      },
      {
        title: "Keep your margin",
        body: "A flat 2% means more of each sale stays with the maker — not a 15%-plus cut disappearing into a marketplace.",
      },
    ],
    bullets: [
      "Your own branded gallery storefront",
      "Build a list of collectors who love your work",
      "Pickup, shipping, or local delivery",
      "Your photos, your story, your vibe — all yours",
    ],
  },
  everything: {
    label: "Everything else",
    eg: "If you can box it, you can drop it",
    img: "/categories/landing/everything-1.png",
    img2: "/categories/landing/everything-2.png",
    accent: "tertiary",
    headline: "Whatever you sell, drop it on DropQ.",
    sub: "Plants, candles, coffee, books, gear — if it's a product people line up for, DropQ runs the drop from open to sold-out.",
    features: [
      {
        title: "Timed drops for any product",
        body: "Set what you're selling, how many, and when ordering opens. DropQ handles the countdown, the cart, and the checkout.",
      },
      {
        title: "Inventory that never oversells",
        body: "Real stock counts stop the sale at sold-out, every time — no spreadsheets, no manual tracking, no refunds.",
      },
      {
        title: "Customers you keep",
        body: "Build a list, notify them for the next drop, and turn one-time buyers into regulars who keep coming back.",
      },
    ],
    bullets: [
      "Your store, your brand, your rules",
      "Flat 2% — no commission, no listing fees",
      "Pickup, delivery, or shipping",
      "Live in minutes, no code required",
    ],
  },
};

const ACCENTS: Record<Accent, { chip: string; dot: string; check: string }> = {
  brand: { chip: "bg-brand-tint text-brand-dark", dot: "bg-brand", check: "bg-brand-tint text-brand-dark" },
  tertiary: { chip: "bg-tertiary-tint text-[#067b7d]", dot: "bg-tertiary", check: "bg-tertiary-tint text-[#067b7d]" },
  quad: { chip: "bg-quad-tint text-ink", dot: "bg-quad", check: "bg-quad-tint text-ink" },
};

export function generateStaticParams() {
  return Object.keys(CATEGORIES).map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const c = CATEGORIES[category];
  if (!c) return { title: "Sell on DropQ" };
  const title = `DropQ for ${c.label} — ${c.headline}`;
  return {
    title,
    description: c.sub,
    openGraph: { title, description: c.sub, url: `https://www.drop-q.com/sell/${category}`, type: "website" },
    twitter: { card: "summary_large_image", title, description: c.sub },
  };
}

export default async function SellCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const c = CATEGORIES[category];
  if (!c) notFound();
  const a = ACCENTS[c.accent];

  return (
    <main className="bg-cream text-ink">
      <SiteNav />

      {/* HERO */}
      <section className="max-w-6xl mx-auto px-5 pt-12 pb-16 sm:pt-20 sm:pb-20 grid lg:grid-cols-2 gap-12 items-center">
        <Reveal>
          <span className={`inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] px-3 py-1.5 rounded-pill ${a.chip}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${a.dot}`} /> DropQ for {c.label}
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mt-5 leading-[1.05]">
            {c.headline}
          </h1>
          <p className="text-lg text-ink-soft mt-5 max-w-xl">{c.sub}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton href="/signup" size="lg">Start your store free</LinkButton>
            <LinkButton href="/login" variant="ghost" size="lg">Log in →</LinkButton>
          </div>
          <p className="text-sm text-muted mt-4">Free to start · Flat 2% per sale · No code</p>
        </Reveal>
        <Reveal delay={120}>
          <div className="relative">
            <div className="absolute -inset-5 hero-glow blur-2xl" aria-hidden />
            <div className="relative rounded-card overflow-hidden shadow-[var(--shadow-lift)] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.img} alt={c.label} className="w-full aspect-[4/3] object-cover" />
            </div>
          </div>
        </Reveal>
      </section>

      {/* UNIQUE VALUE */}
      <section className="max-w-6xl mx-auto px-5 py-16 sm:py-20">
        <Reveal className="max-w-2xl">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
            What DropQ does for {c.label.toLowerCase()}.
          </h2>
          <p className="text-lg text-ink-soft mt-4">
            Not a generic store builder — a drop engine tuned to how you actually sell.
          </p>
        </Reveal>
        <div className="grid sm:grid-cols-3 gap-5 mt-12 items-start">
          {c.features.map((f, i) => (
            <Reveal key={f.title} delay={i * 90}>
              <Card className="p-6 h-full">
                <span className={`inline-grid place-items-center w-10 h-10 rounded-xl text-lg font-display font-semibold ${a.check}`}>
                  {i + 1}
                </span>
                <h3 className="font-semibold text-lg mt-4">{f.title}</h3>
                <p className="text-sm text-muted mt-2 leading-relaxed">{f.body}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      {/* BUILT FOR YOU — bullets + image */}
      <div className="bg-paper border-y border-line">
        <section className="max-w-6xl mx-auto px-5 py-16 sm:py-24 grid lg:grid-cols-2 gap-12 items-center">
          <Reveal>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
              Built for the way {c.label.toLowerCase()} really sells.
            </h2>
            <ul className="mt-7 space-y-4">
              {c.bullets.map((b) => (
                <li key={b} className="flex gap-3 text-ink-soft">
                  <span className={`mt-0.5 w-5 h-5 rounded-full grid place-items-center text-xs shrink-0 ${a.check}`}>✓</span>
                  {b}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <LinkButton href="/signup" size="lg">Start your store free</LinkButton>
              <LinkButton href="/login" variant="secondary" size="lg">Log in</LinkButton>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-card overflow-hidden shadow-[var(--shadow-soft)] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.img2} alt={c.label} className="w-full aspect-[5/4] object-cover" />
            </div>
          </Reveal>
        </section>
      </div>

      {/* FINAL CTA */}
      <section className="max-w-6xl mx-auto px-5 py-20 sm:py-28 text-center">
        <Reveal>
          <h2 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight max-w-2xl mx-auto">
            Your next drop is waiting.
          </h2>
          <p className="text-lg text-ink-soft mt-5 max-w-xl mx-auto">
            Set up your {c.label.toLowerCase()} storefront in minutes and run your first drop this week. Free to start.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <LinkButton href="/signup" size="lg">Start your store</LinkButton>
            <LinkButton href="/login" variant="secondary" size="lg">Log in</LinkButton>
          </div>
          <p className="mt-6 text-sm text-muted">
            Not sure where you fit?{" "}
            <Link href="/#sell" className="text-ink font-medium hover:underline">See every kind of seller →</Link>
          </p>
        </Reveal>
      </section>

      <SiteFooter />
    </main>
  );
}
