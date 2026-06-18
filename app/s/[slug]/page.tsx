import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { Mark } from "@/components/logo";
import { WaitlistForm } from "@/components/waitlist-form";
import { formatMoney, formatDate } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const seller = await prisma.seller.findUnique({ where: { slug } });
  return { title: seller ? `${seller.storeName} — DropQ` : "Store — DropQ" };
}

export default async function StorePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const seller = await prisma.seller.findUnique({
    where: { slug },
    include: {
      drops: {
        orderBy: { createdAt: "desc" },
        include: { products: true },
      },
    },
  });
  if (!seller) notFound();

  const accent = seller.accent || "#6D28D9";
  const liveDrops = seller.drops.filter((d) => d.status === "live");
  const pastDrops = seller.drops.filter((d) => d.status === "closed");

  return (
    <main className="min-h-screen">
      {/* Banner */}
      <div className="relative h-32 sm:h-44" style={{ backgroundColor: accent }}>
        <Link
          href="/"
          className="absolute top-4 left-4 inline-flex items-center gap-1.5 rounded-pill bg-black/25 hover:bg-black/40 text-white text-sm font-medium px-3.5 py-2 backdrop-blur-sm transition"
        >
          <span aria-hidden>←</span> Back
        </Link>
      </div>
      <div className="max-w-3xl mx-auto px-5">
        <div className="-mt-12 sm:-mt-14">
          <div
            className="w-24 h-24 rounded-3xl bg-paper border-4 border-cream grid place-items-center text-4xl shadow-[var(--shadow-soft)]"
            style={{ color: accent }}
          >
            {seller.storeName.charAt(0)}
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-4">
            {seller.storeName}
          </h1>
          {seller.tagline && <p className="text-lg text-ink-soft mt-1">{seller.tagline}</p>}
          <div className="flex items-center gap-3 text-sm text-muted mt-2">
            {seller.location && <span>📍 {seller.location}</span>}
            <span>·</span>
            <span>Powered by DropQ</span>
          </div>
          {seller.bio && <p className="text-ink-soft mt-4 max-w-xl">{seller.bio}</p>}
        </div>

        {/* Live drops */}
        <section className="mt-10">
          <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
            {liveDrops.length > 0 && (
              <span className="w-2 h-2 rounded-full live-dot" style={{ backgroundColor: accent }} />
            )}
            {liveDrops.length > 0 ? "Available now" : "No drops open right now"}
          </h2>

          {liveDrops.length === 0 && (
            <div className="bg-paper border border-dashed border-line-strong rounded-card p-6 text-center text-muted mb-4">
              Check back soon — or sign up below to hear about the next drop.
            </div>
          )}

          <div className="space-y-4">
            {liveDrops.map((d) => {
              const sold = d.products.reduce((s, p) => s + p.sold, 0);
              const stock = d.products.reduce((s, p) => s + p.inventory, 0);
              const minPrice = Math.min(...d.products.map((p) => p.priceCents));
              return (
                <Link
                  key={d.id}
                  href={`/s/${seller.slug}/${d.id}`}
                  className="block bg-paper border border-line rounded-card p-6 hover:shadow-[var(--shadow-lift)] transition group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span
                        style={{ backgroundColor: accent }}
                        className="inline-flex items-center gap-1.5 text-white text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill mb-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-white live-dot" /> Live
                      </span>
                      <h3 className="font-display text-xl font-semibold">{d.title}</h3>
                      {d.description && <p className="text-muted mt-1 line-clamp-2">{d.description}</p>}
                      {d.pickupInfo && (
                        <p className="text-sm text-ink-soft mt-2">
                          {d.fulfillment === "pickup" ? "🥡" : d.fulfillment === "delivery" ? "🚗" : "📦"} {d.pickupInfo}
                        </p>
                      )}
                    </div>
                    <span
                      className="shrink-0 text-sm font-semibold rounded-pill px-4 py-2 text-white group-hover:opacity-90"
                      style={{ backgroundColor: accent }}
                    >
                      Order →
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted mt-4">
                    <span>{d.products.length} items</span>
                    <span>From {formatMoney(minPrice)}</span>
                    <span>{stock - sold} of {stock} left</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Future-drop sign up */}
        <section className="mt-8 max-w-md">
          <WaitlistForm
            sellerId={seller.id}
            storeName={seller.storeName}
            accent={accent}
            geofence={seller.geofenceEnabled}
          />
        </section>

        {/* Past drops */}
        {pastDrops.length > 0 && (
          <section className="mt-10 pb-16">
            <h2 className="font-semibold text-lg mb-4">Past drops</h2>
            <div className="space-y-2">
              {pastDrops.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between bg-paper/60 border border-line rounded-xl px-4 py-3 text-sm"
                >
                  <span className="font-medium">{d.title}</span>
                  <span className="text-muted">Closed · {formatDate(d.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="py-10 border-t border-line flex items-center justify-center gap-2 text-sm text-muted">
          <Mark size={18} /> Want a store like this?{" "}
          <Link href="/" className="text-ink font-medium hover:underline">Start free on DropQ</Link>
        </footer>
      </div>
    </main>
  );
}
