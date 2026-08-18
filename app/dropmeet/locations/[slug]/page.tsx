import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { publicLocation, appearancesFor, REGION_TZ } from "@/lib/dropmeet/query";
import { expandOccurrences, describeRule } from "@/lib/dropmeet/schedule";
import {
  locationTypeLabel,
  marketTypeLabel,
  VERIFICATION_PUBLIC_LABEL,
  type VerificationStatus,
} from "@/lib/dropmeet/types";
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
  const loc = await publicLocation(slug);
  if (!loc) return { title: "Place not found — DropMeet" };

  const where = [loc.city, loc.state].filter(Boolean).join(", ");
  const description =
    loc.description?.slice(0, 155) ??
    `${loc.name} — ${locationTypeLabel(loc.locationType)}${where ? ` in ${where}` : ""}. See upcoming markets, events, and DropQ vendors selling here.`;

  return {
    title: `${loc.name}${where ? ` — ${where}` : ""} | DropMeet`,
    description,
    alternates: { canonical: `/dropmeet/locations/${loc.slug}` },
    openGraph: {
      title: loc.name,
      description,
      url: `/dropmeet/locations/${loc.slug}`,
      type: "website",
      images: loc.imageUrl ? [loc.imageUrl] : undefined,
    },
  };
}

export default async function LocationPage({ params }: Params) {
  const { slug } = await params;
  const loc = await publicLocation(slug);
  if (!loc) notFound();

  const [appearances, customer] = await Promise.all([
    appearancesFor({ locationId: loc.id }),
    getCurrentCustomer(),
  ]);

  const following = customer
    ? !!(await prisma.locationFollow.findUnique({
        where: { customerId_locationId: { customerId: customer.id, locationId: loc.id } },
      }))
    : false;

  const verificationLabel =
    VERIFICATION_PUBLIC_LABEL[loc.verificationStatus as VerificationStatus];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: loc.name,
    description: loc.description ?? undefined,
    url: `/dropmeet/locations/${loc.slug}`,
    image: loc.imageUrl ?? undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: loc.address ?? undefined,
      addressLocality: loc.city ?? undefined,
      addressRegion: loc.state ?? undefined,
      postalCode: loc.postalCode ?? undefined,
      addressCountry: "US",
    },
    geo: { "@type": "GeoCoordinates", latitude: loc.latitude, longitude: loc.longitude },
  };

  return (
    <main className="min-h-dvh bg-cream pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="relative">
        {loc.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={loc.imageUrl} alt="" className="w-full h-48 sm:h-64 object-cover" />
        ) : (
          <div className="w-full h-32 sm:h-40 bg-grey-tint" />
        )}
        <div className="absolute top-3 left-3">
          <Link
            href="/dropmeet"
            className="inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-pill bg-paper/95 backdrop-blur border border-line text-sm font-semibold shadow-[var(--shadow-soft)]"
          >
            ← DropMeet
          </Link>
        </div>
      </div>

      <div className="p-4 sm:p-6 max-w-3xl mx-auto -mt-8 relative">
        <div className="bg-paper border border-line rounded-card p-5 sm:p-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-grey-tint text-[#3f434b]">{locationTypeLabel(loc.locationType)}</Badge>
            {verificationLabel && <span className="text-xs text-muted">{verificationLabel}</span>}
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
            {loc.name}
          </h1>
          {loc.address && <p className="text-muted mt-1">{loc.address}</p>}

          {loc.description && (
            <p className="text-ink-soft mt-4 leading-relaxed whitespace-pre-wrap">{loc.description}</p>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            <DirectionsButton address={loc.address} lat={loc.latitude} lng={loc.longitude} />
            <FollowButton
              kind="location"
              id={loc.id}
              slug={loc.slug}
              following={following}
              signedIn={!!customer}
            />
            {loc.websiteUrl && (
              <a
                href={loc.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
              >
                Website ↗
              </a>
            )}
          </div>
        </div>

        {/* Markets held here */}
        {loc.markets.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-lg font-semibold mb-3">Markets here</h2>
            <ul className="space-y-3">
              {loc.markets.map((m) => {
                const next = expandOccurrences(m.schedules, m.exceptions, {
                  from: new Date(),
                  days: 21,
                  timezone: REGION_TZ,
                }).find((o) => !o.cancelled);
                return (
                  <li key={m.id}>
                    <Link
                      href={`/dropmeet/markets/${m.slug}`}
                      className="block bg-paper border border-line rounded-card p-4 hover:border-ink/25 transition"
                    >
                      <p className="font-display font-semibold">{m.name}</p>
                      <p className="text-xs text-muted mt-0.5">{marketTypeLabel(m.marketType)}</p>
                      {m.schedules[0] && (
                        <p className="text-sm text-ink-soft mt-1">{describeRule(m.schedules[0])}</p>
                      )}
                      {next && (
                        <p className="text-xs text-brand font-semibold mt-1">
                          Next:{" "}
                          {new Date(next.start).toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "short",
                            day: "numeric",
                            timeZone: REGION_TZ,
                          })}
                        </p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Upcoming events */}
        {loc.events.length > 0 && (
          <section className="mt-6">
            <h2 className="font-display text-lg font-semibold mb-3">Upcoming events</h2>
            <ul className="space-y-3">
              {loc.events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/dropmeet/events/${e.slug}`}
                    className="block bg-paper border border-line rounded-card p-4 hover:border-ink/25 transition"
                  >
                    <p className="text-[11px] font-bold tracking-wide text-brand">
                      {e.startDateTime.toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "short",
                        day: "numeric",
                        timeZone: REGION_TZ,
                      })}
                    </p>
                    <p className="font-display font-semibold mt-0.5">{e.name}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold mb-3">DropQ Vendors Here</h2>
          <VendorAppearanceList
            appearances={appearances}
            emptyCta={<InviteVendorPanel locationId={loc.id} />}
          />
          {appearances.length > 0 && (
            <div className="mt-4">
              <InviteVendorPanel locationId={loc.id} />
            </div>
          )}
        </section>


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
            className="mt-4 inline-flex items-center justify-center min-h-[48px] px-6 rounded-pill bg-ink text-cream text-sm font-semibold transition active:scale-[0.98] hover:bg-ink-soft"
          >
            Add a place
          </Link>
        </section>

        <section className="mt-8">
          <ClaimPanel entityType="location" entityId={loc.id} name={loc.name} />
        </section>
      </div>
    </main>
  );
}
