import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { cancelAppearanceAction } from "@/lib/actions/dropmeet";
import { AppearanceForm } from "@/components/dropmeet/appearance-form";
import { PageHeader, Section, EmptyState } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { REGION_TZ } from "@/lib/dropmeet/query";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where I'll Be — DropQ" };

export default async function WhereIllBePage() {
  const seller = await requireSeller();

  const [appearances, drops] = await Promise.all([
    prisma.vendorAppearance.findMany({
      where: { sellerId: seller.id, status: { not: "cancelled" } },
      orderBy: { startDateTime: "asc" },
      include: {
        market: { select: { name: true, slug: true } },
        location: { select: { name: true, slug: true, city: true } },
        event: { select: { name: true, slug: true } },
        drop: { select: { id: true, title: true, status: true } },
      },
    }),
    prisma.drop.findMany({
      where: { sellerId: seller.id, status: { in: ["live", "draft"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, status: true },
      take: 25,
    }),
  ]);

  const now = new Date();
  const upcoming = appearances.filter((a) => (a.endDateTime ?? a.startDateTime) >= now);
  const past = appearances.filter((a) => (a.endDateTime ?? a.startDateTime) < now).reverse();

  return (
    <Section>
      <PageHeader
        title="Where I'll Be"
        subtitle="Tell customers which markets and places you're selling at — and let them preorder before they arrive."
      />

      <div className="mb-8">
        <AppearanceForm drops={drops} />
      </div>

      <h2 className="font-display text-lg font-semibold mb-3">Upcoming</h2>
      {upcoming.length === 0 ? (
        <EmptyState
          emoji="🗺️"
          title="No appearances yet"
          body="Add where you'll be selling and you'll show up on DropMeet for anyone browsing that market."
          ctaHref="/dropmeet"
          ctaLabel="Browse DropMeet"
        />
      ) : (
        <ul className="space-y-3 mb-10">
          {upcoming.map((a) => {
            const place = a.market ?? a.location ?? a.event;
            const href = a.market
              ? `/dropmeet/markets/${a.market.slug}`
              : a.location
                ? `/dropmeet/locations/${a.location.slug}`
                : a.event
                  ? `/dropmeet/events/${a.event.slug}`
                  : null;

            return (
              <li key={a.id} className="bg-paper border border-line rounded-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold tracking-wide text-brand">
                      {a.startDateTime
                        .toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "short",
                          day: "numeric",
                          timeZone: REGION_TZ,
                        })
                        .toUpperCase()}
                    </p>
                    {href ? (
                      <Link href={href} className="font-display font-semibold hover:underline">
                        {place?.name}
                      </Link>
                    ) : (
                      <span className="font-display font-semibold">{place?.name}</span>
                    )}
                    <p className="text-sm text-muted mt-0.5">
                      {a.startDateTime.toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: REGION_TZ,
                      })}
                      {a.endDateTime
                        ? `–${a.endDateTime.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: REGION_TZ,
                          })}`
                        : ""}
                      {a.boothInfo ? ` · ${a.boothInfo}` : ""}
                    </p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {a.drop ? (
                        <Badge className="bg-brand-tint text-brand-dark">
                          Preorder: {a.drop.title}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted">No drop attached</span>
                      )}
                      <Badge className="bg-grey-tint text-[#3f434b]">{a.status}</Badge>
                    </div>
                  </div>

                  <form action={cancelAppearanceAction} className="shrink-0">
                    <input type="hidden" name="appearanceId" value={a.id} />
                    <button className="inline-flex items-center min-h-[40px] px-4 rounded-pill border border-line-strong text-sm font-medium text-ink-soft hover:border-ink/30 transition">
                      Cancel
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <h2 className="font-display text-lg font-semibold mb-3">Past</h2>
          <ul className="space-y-2">
            {past.slice(0, 10).map((a) => (
              <li key={a.id} className="text-sm text-muted flex items-center gap-2">
                <span>
                  {a.startDateTime.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    timeZone: REGION_TZ,
                  })}
                </span>
                <span className="text-ink-soft">
                  {(a.market ?? a.location ?? a.event)?.name}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
