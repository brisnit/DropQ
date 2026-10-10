import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { Reveal } from "@/components/reveal";
import { LinkButton } from "@/components/ui";
import { INTERNAL_KINDS } from "@/lib/reporting";
import { browseOriginQuery } from "@/lib/browse-origin";

export const metadata: Metadata = {
  title: "Vendors on DropQ",
  description:
    "Every independent seller running drops on DropQ — bakers, makers, collectors and more.",
};

// A directory is only useful if it is current, and it costs one indexed query.
export const revalidate = 300;

/**
 * The public vendor directory.
 *
 * ── WHO APPEARS, AND WHY THAT LINE ────────────────────────────────────────
 *
 * Any vendor who has PUBLISHED AT LEAST ONE DROP, excluding internal accounts
 * and disabled stores. Deliberately not gated on `isDiscoverable`, which
 * defaults to false and would have left this page empty.
 *
 * Publishing a drop is already a public act — it puts a storefront at
 * /s/<slug> that anyone can open and order from. Listing those stores
 * surfaces something the seller already chose to make public. An account that
 * has never published has chosen nothing, and an empty storefront is a poor
 * first impression for the vendor as much as the visitor, so those are left
 * out until there is something to show.
 */
export default async function VendorsPage() {
  const vendors = await prisma.seller.findMany({
    where: {
      disabledAt: null,
      // Founder, canary, staff, demo, docs and harness accounts are ours, not
      // vendors. The same list reporting uses, so the two cannot disagree.
      OR: [{ internalKind: null }, { internalKind: { notIn: [...INTERNAL_KINDS] } }],
      drops: { some: { isPublic: true, status: { in: ["live", "closed"] } } },
    },
    select: {
      id: true,
      slug: true,
      storeName: true,
      tagline: true,
      category: true,
      logoUrl: true,
      publicCity: true,
      publicState: true,
      location: true,
      drops: {
        where: { isPublic: true, status: "live" },
        select: { id: true },
      },
    },
    orderBy: [{ storeName: "asc" }],
    take: 200,
  });

  // A vendor with something on sale right now goes first — that is the one
  // thing a visitor to this page can act on today.
  const sorted = [...vendors].sort((a, b) => {
    const live = b.drops.length - a.drops.length ? (b.drops.length > 0 ? 1 : -1) : 0;
    return live || a.storeName.localeCompare(b.storeName);
  });

  const liveCount = sorted.filter((v) => v.drops.length > 0).length;

  return (
    <>
      <SiteNav />
      <main className="bg-cream text-ink min-h-screen">
        <section className="max-w-5xl mx-auto px-5 pt-12 pb-8 sm:pt-16">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
              The directory
            </p>
            <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mt-3">
              Vendors on DropQ
            </h1>
            <p className="text-lg text-ink-soft mt-4 max-w-xl">
              Independent sellers running drops — bakers, makers, collectors and
              more. {liveCount > 0
                ? `${liveCount} ${liveCount === 1 ? "has something" : "have something"} on sale right now.`
                : "Check back for what's on sale."}
            </p>
          </Reveal>
        </section>

        <section className="max-w-5xl mx-auto px-5 pb-16">
          {sorted.length === 0 ? (
            <div className="rounded-card border border-dashed border-line-strong p-10 text-center">
              <p className="text-ink-soft">
                No vendors have published a drop yet. If that could be you —
              </p>
              <div className="mt-5">
                <LinkButton href="/signup" size="lg">Start selling on DropQ</LinkButton>
              </div>
            </div>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sorted.map((v, i) => {
                const live = v.drops.length;
                const place = [v.publicCity ?? v.location, v.publicState]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <Reveal key={v.id} delay={Math.min(i, 8) * 50}>
                    <li className="h-full">
                      <Link
                        href={`/s/${v.slug}${browseOriginQuery("vendors")}`}
                        className="group h-full flex flex-col bg-paper border border-line rounded-card p-5 hover:border-ink/25 hover:shadow-[var(--shadow-soft)] transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {v.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={v.logoUrl}
                              alt=""
                              className="w-12 h-12 rounded-xl object-cover border border-line shrink-0"
                            />
                          ) : (
                            <span
                              className="w-12 h-12 rounded-xl bg-cream border border-line grid place-items-center text-xl shrink-0"
                              aria-hidden
                            >
                              🏷️
                            </span>
                          )}
                          <div className="min-w-0">
                            <h2 className="font-semibold truncate group-hover:text-brand transition-colors">
                              {v.storeName}
                            </h2>
                            {place && (
                              <p className="text-xs text-muted truncate">{place}</p>
                            )}
                          </div>
                        </div>

                        {v.tagline && (
                          <p className="text-sm text-ink-soft mt-3 line-clamp-2">
                            {v.tagline}
                          </p>
                        )}

                        <div className="mt-auto pt-4 flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium px-2.5 py-1 rounded-pill bg-cream border border-line text-muted capitalize">
                            {v.category}
                          </span>
                          {live > 0 && (
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-tertiary-tint text-[#046b6d]">
                              {live === 1 ? "Drop on now" : `${live} drops on now`}
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  </Reveal>
                );
              })}
            </ul>
          )}
        </section>

        <section className="max-w-5xl mx-auto px-5 pb-20">
          <div className="rounded-card border border-line bg-paper p-6 sm:p-10 text-center">
            <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight">
              Want your store listed here?
            </h2>
            <p className="text-ink-soft mt-3">
              Publish your first drop and you&apos;re on the list.
            </p>
            <div className="mt-6">
              <LinkButton href="/signup" size="lg">Start selling free</LinkButton>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
