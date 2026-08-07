import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { publicMarket, appearancesFor, upcomingOccurrences, REGION_TZ } from "@/lib/dropmeet/query";
import { describeRule, formatTime } from "@/lib/dropmeet/schedule";
import { marketTypeLabel, VERIFICATION_PUBLIC_LABEL, type VerificationStatus } from "@/lib/dropmeet/types";
import { VendorAppearanceList } from "@/components/dropmeet/vendor-list";
import {
  DirectionsButton,
  FollowButton,
  ClaimPanel,
  InviteVendorPanel,
} from "@/components/dropmeet/actions-bar";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const market = await publicMarket(slug);
  if (!market) return { title: "Market not found — DropMeet" };

  const where = [market.location.city, market.location.state].filter(Boolean).join(", ");
  const when = market.schedules[0] ? describeRule(market.schedules[0]) : null;
  const description =
    market.description?.slice(0, 155) ??
    `${market.name} — ${marketTypeLabel(market.marketType)}${where ? ` in ${where}` : ""}${
      when ? `. ${when}.` : "."
    } See who's selling and what you can preorder on DropQ.`;

  return {
    title: `${market.name} — ${marketTypeLabel(market.marketType)}${where ? ` in ${where}` : ""} | DropMeet`,
    description,
    alternates: { canonical: `/dropmeet/markets/${market.slug}` },
    openGraph: {
      title: market.name,
      description,
      url: `/dropmeet/markets/${market.slug}`,
      type: "website",
      images: market.imageUrl ? [market.imageUrl] : undefined,
    },
  };
}

export default async function MarketPage({ params }: Params) {
  const { slug } = await params;

  // publicMarket only ever returns approved rows — a pending market 404s here,
  // which is also what keeps it out of search engines.
  const market = await publicMarket(slug);
  if (!market) notFound();

  const [appearances, customer] = await Promise.all([
    appearancesFor({ marketId: market.id }),
    getCurrentCustomer(),
  ]);

  const following = customer
    ? !!(await prisma.marketFollow.findUnique({
        where: { customerId_marketId: { customerId: customer.id, marketId: market.id } },
      }))
    : false;

  const occurrences = upcomingOccurrences(market).slice(0, 6);
  const next = occurrences.find((o) => !o.cancelled) ?? null;
  const verificationLabel =
    VERIFICATION_PUBLIC_LABEL[market.verificationStatus as VerificationStatus];

  // Structured data so "farmers markets san diego" can surface a real result.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: market.name,
    description: market.description ?? undefined,
    url: `/dropmeet/markets/${market.slug}`,
    image: market.imageUrl ?? undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: market.location.address ?? undefined,
      addressLocality: market.location.city ?? undefined,
      addressRegion: market.location.state ?? undefined,
      postalCode: market.location.postalCode ?? undefined,
      addressCountry: "US",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: market.location.latitude,
      longitude: market.location.longitude,
    },
    ...(market.websiteUrl ? { sameAs: [market.websiteUrl] } : {}),
  };

  return (
    <main className="min-h-dvh bg-cream pb-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <div className="relative">
        {market.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={market.imageUrl} alt="" className="w-full h-48 sm:h-64 object-cover" />
        ) : (
          <div className="w-full h-32 sm:h-40 bg-grey-tint" />
        )}
        <div className="absolute top-3 left-3">
          <Link
            href="/dropmeet"
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-pill bg-paper/95 backdrop-blur border border-line text-sm font-semibold shadow-[var(--shadow-soft)]"
          >
            ← DropMeet
          </Link>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-3xl mx-auto -mt-8 relative">
        <div className="bg-paper border border-line rounded-card p-5 sm:p-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-grey-tint text-[#3f434b]">{marketTypeLabel(market.marketType)}</Badge>
            {verificationLabel && (
              <span className="text-xs text-muted">{verificationLabel}</span>
            )}
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
            {market.name}
          </h1>

          {next && (
            <p className="text-brand font-semibold mt-1.5">
              {new Date(next.start).toLocaleDateString("en-US", {
                weekday: "long",
                timeZone: REGION_TZ,
              })}
              {next.startTime && next.endTime
                ? ` · ${formatTime(next.startTime)}–${formatTime(next.endTime)}`
                : ""}
            </p>
          )}

          <p className="text-muted mt-1">
            <Link href={`/dropmeet/locations/${market.location.slug}`} className="hover:underline">
              {market.location.name}
            </Link>
            {market.location.address ? ` · ${market.location.address}` : ""}
          </p>

          {market.description && (
            <p className="text-ink-soft mt-4 leading-relaxed whitespace-pre-wrap">
              {market.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            <DirectionsButton
              address={market.location.address}
              lat={market.location.latitude}
              lng={market.location.longitude}
            />
            <FollowButton
              kind="market"
              id={market.id}
              slug={market.slug}
              following={following}
              signedIn={!!customer}
            />
            {market.websiteUrl && (
              <a
                href={market.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
              >
                Website ↗
              </a>
            )}
          </div>
        </div>

        {/* Schedule */}
        {market.schedules.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-lg font-semibold mb-3">Schedule</h2>
            <div className="bg-paper border border-line rounded-card p-5">
              <ul className="space-y-1.5">
                {market.schedules.map((s) => (
                  <li key={s.id} className="text-ink-soft">
                    {describeRule(s)}
                    {s.notes && <span className="text-muted text-sm"> — {s.notes}</span>}
                  </li>
                ))}
              </ul>

              {occurrences.length > 0 && (
                <div className="mt-4 pt-4 border-t border-line">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                    Next dates
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {occurrences.map((o) => (
                      <li
                        key={o.date}
                        className={`px-3 py-1.5 rounded-pill text-sm ${
                          o.cancelled
                            ? "bg-brand-tint text-brand-dark line-through"
                            : "bg-cream border border-line"
                        }`}
                        title={o.note ?? undefined}
                      >
                        {new Date(o.start).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: REGION_TZ,
                        })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Vendors */}
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold mb-3">DropQ Vendors Here</h2>
          <VendorAppearanceList
            appearances={appearances}
            emptyCta={<InviteVendorPanel marketId={market.id} />}
          />
          {appearances.length > 0 && (
            <div className="mt-4">
              <InviteVendorPanel marketId={market.id} />
            </div>
          )}
        </section>

        {/* Organizer */}

        {/* Community CTA — noticing a gap usually happens while looking at a
            place you already know. */}
        <section className="mt-6 bg-paper border border-dashed border-line-strong rounded-card p-5 text-center">
          <p className="font-display font-semibold">Know another place we&apos;re missing?</p>
          <p className="text-sm text-muted mt-1">
            Add any San Diego County spot where local vendors sell. Our team reviews every
            submission.
          </p>
          <Link
            href="/dropmeet/add"
            className="mt-4 inline-flex items-center justify-center gap-2 min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold transition active:scale-[0.98] hover:bg-ink-soft"
          >
            <span aria-hidden>📍</span> Add a place
          </Link>
        </section>

        <section className="mt-8">
          <ClaimPanel entityType="market" entityId={market.id} name={market.name} />
        </section>
      </div>
    </main>
  );
}
