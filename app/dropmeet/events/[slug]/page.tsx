import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicEvent, appearancesFor, REGION_TZ } from "@/lib/dropmeet/query";
import { eventTypeLabel, VERIFICATION_PUBLIC_LABEL, type VerificationStatus } from "@/lib/dropmeet/types";
import { VendorAppearanceList } from "@/components/dropmeet/vendor-list";
import { DirectionsButton, InviteVendorPanel } from "@/components/dropmeet/actions-bar";
import { Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const event = await publicEvent(slug);
  if (!event) return { title: "Event not found — DropMeet" };

  const when = event.startDateTime.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: REGION_TZ,
  });
  const description =
    event.description?.slice(0, 155) ??
    `${event.name} — ${eventTypeLabel(event.eventType)} on ${when}${
      event.location?.city ? ` in ${event.location.city}` : ""
    }. See which vendors are attending and what you can preorder.`;

  return {
    title: `${event.name} — ${when} | DropMeet`,
    description,
    alternates: { canonical: `/dropmeet/events/${event.slug}` },
    openGraph: {
      title: event.name,
      description,
      url: `/dropmeet/events/${event.slug}`,
      type: "website",
      images: event.imageUrl ? [event.imageUrl] : undefined,
    },
  };
}

export default async function EventPage({ params }: Params) {
  const { slug } = await params;
  const event = await publicEvent(slug);
  if (!event) notFound();

  const appearances = await appearancesFor({ eventId: event.id });
  const verificationLabel =
    VERIFICATION_PUBLIC_LABEL[event.verificationStatus as VerificationStatus];

  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: REGION_TZ,
    });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.name,
    description: event.description ?? undefined,
    startDate: event.startDateTime.toISOString(),
    endDate: event.endDateTime?.toISOString(),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: event.imageUrl ?? undefined,
    location: {
      "@type": "Place",
      name: event.location?.name ?? event.name,
      address: event.location
        ? {
            "@type": "PostalAddress",
            streetAddress: event.location.address ?? undefined,
            addressLocality: event.location.city ?? undefined,
            addressRegion: event.location.state ?? undefined,
            addressCountry: "US",
          }
        : undefined,
      geo: {
        "@type": "GeoCoordinates",
        latitude: event.latitude,
        longitude: event.longitude,
      },
    },
  };

  return (
    <main className="min-h-dvh bg-cream pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="relative">
        {event.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt="" className="w-full h-48 sm:h-64 object-cover" />
        ) : (
          <div className="w-full h-32 sm:h-40 bg-quad-tint" />
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
            <Badge className="bg-quad-tint text-[#8a6a00]">{eventTypeLabel(event.eventType)}</Badge>
            {verificationLabel && <span className="text-xs text-muted">{verificationLabel}</span>}
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
            {event.name}
          </h1>
          <p className="text-brand font-semibold mt-1.5">{fmt(event.startDateTime)}</p>
          {event.endDateTime && (
            <p className="text-sm text-muted">Until {fmt(event.endDateTime)}</p>
          )}

          {event.location && (
            <p className="text-muted mt-2">
              <Link href={`/dropmeet/locations/${event.location.slug}`} className="hover:underline">
                {event.location.name}
              </Link>
              {event.location.address ? ` · ${event.location.address}` : ""}
            </p>
          )}
          {event.market && (
            <p className="text-sm text-muted mt-1">
              Part of{" "}
              <Link href={`/dropmeet/markets/${event.market.slug}`} className="text-brand hover:underline">
                {event.market.name}
              </Link>
            </p>
          )}

          {event.description && (
            <p className="text-ink-soft mt-4 leading-relaxed whitespace-pre-wrap">
              {event.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            <DirectionsButton
              address={event.location?.address}
              lat={event.latitude}
              lng={event.longitude}
            />
            {event.websiteUrl && (
              <a
                href={event.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold hover:border-ink/30 transition"
              >
                Website ↗
              </a>
            )}
          </div>
        </div>

        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold mb-3">DropQ Vendors Here</h2>
          <VendorAppearanceList
            appearances={appearances}
            emptyCta={<InviteVendorPanel locationId={event.locationId ?? undefined} />}
          />
        </section>
      </div>
    </main>
  );
}
