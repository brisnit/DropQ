import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentSeller } from "@/lib/auth";
import { isWalkUpEnabled } from "@/lib/walkup";
import { hasGrowthFeatures } from "@/lib/plans";
import { prisma } from "@/lib/db";
import { availableArticles } from "@/lib/help/search";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/help/types";
import { NO_CAPABILITIES, type GuidanceCapabilities } from "@/lib/guidance";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: "Help — DropQ",
  description: "How DropQ works: drops, payments, orders, QR codes and sharing.",
};

/**
 * Capabilities for whoever is reading.
 *
 * A signed-in vendor sees what they can actually use; a signed-out visitor sees
 * only the universally-available articles. Flag-gated features are never
 * documented to people who do not have them — that is the same rule the in-app
 * panel follows, applied to the public page.
 */
export async function readerCapabilities(): Promise<GuidanceCapabilities> {
  const seller = await getCurrentSeller();
  if (!seller) return NO_CAPABILITIES;
  return {
    walkUp: isWalkUpEnabled(seller),
    dropMeet: (await prisma.region.count({ where: { active: true } })) > 0,
    growthFeatures: hasGrowthFeatures(seller),
  };
}

export default async function HelpIndexPage() {
  const caps = await readerCapabilities();
  const articles = availableArticles(caps);

  return (
    <>
      <SiteNav />
      <main className="max-w-3xl mx-auto px-5 py-14">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">
          DropQ help
        </h1>
        <p className="text-muted mt-3 max-w-prose">
          How DropQ actually works — written against the product, not a brochure.
          If something here doesn&apos;t match what you see, tell us.
        </p>

        <div className="mt-10 space-y-10">
          {CATEGORY_ORDER.map((cat) => {
            const items = articles
              .filter((a) => a.category === cat)
              .sort((a, b) => a.priority - b.priority);
            if (items.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="font-display text-xl font-semibold border-b border-line pb-2">
                  {CATEGORY_LABELS[cat]}
                </h2>
                <ul className="mt-3 divide-y divide-line">
                  {items.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${a.slug}`}
                        className="block py-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded"
                      >
                        <span className="font-medium group-hover:text-brand transition">
                          {a.title}
                        </span>
                        <span className="block text-sm text-muted mt-0.5">{a.summary}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
