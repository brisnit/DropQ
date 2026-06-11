import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isStripeEnabled } from "@/lib/stripe";
import { Mark } from "@/components/logo";
import { StorefrontOrder } from "@/components/storefront-order";

export default async function DropOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; dropId: string }>;
  searchParams: Promise<{ canceled?: string }>;
}) {
  const { slug, dropId } = await params;
  const { canceled } = await searchParams;
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: {
      products: { orderBy: { sortOrder: "asc" } },
      seller: true,
    },
  });
  if (!drop || drop.seller.slug !== slug) notFound();

  const accent = drop.seller.accent || "#6D28D9";
  const isLive = drop.status === "live";
  const paymentsEnabled =
    isStripeEnabled() && drop.seller.stripeChargesEnabled && !!drop.seller.stripeAccountId;
  const fulfillmentLabel =
    drop.fulfillment === "pickup" ? "Pickup" : drop.fulfillment === "delivery" ? "Local delivery" : "Shipping";

  return (
    <main className="min-h-screen">
      {/* Top bar */}
      <div className="border-b border-line bg-cream/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href={`/s/${slug}`} className="text-sm text-muted hover:text-ink">
            ← {drop.seller.storeName}
          </Link>
          <span className="text-xs text-muted flex items-center gap-1.5">
            <Mark size={16} /> DropQ
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-5 py-8">
        {canceled && (
          <div className="mb-5 rounded-xl bg-grey-tint text-[#3f434b] px-4 py-3 text-sm">
            Checkout canceled — your cart is still here whenever you're ready.
          </div>
        )}
        {/* Drop header */}
        <div className="mb-7">
          {isLive ? (
            <span
              style={{ backgroundColor: accent }}
              className="inline-flex items-center gap-1.5 text-white text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white live-dot" /> Ordering open
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 bg-line text-ink-soft text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill">
              Ordering closed
            </span>
          )}
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mt-3">
            {drop.title}
          </h1>
          {drop.description && <p className="text-lg text-ink-soft mt-2 max-w-2xl">{drop.description}</p>}
          {drop.pickupInfo && (
            <p className="text-sm text-ink-soft mt-3 inline-flex items-center gap-2 bg-paper border border-line rounded-pill px-3.5 py-1.5">
              <span className="font-medium">{fulfillmentLabel}</span> · {drop.pickupInfo}
            </p>
          )}
        </div>

        {isLive ? (
          <StorefrontOrder
            dropId={drop.id}
            accent={accent}
            paymentsEnabled={paymentsEnabled}
            products={drop.products.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              priceCents: p.priceCents,
              emoji: p.emoji,
              imageUrl: p.imageUrl,
              remaining: Math.max(0, p.inventory - p.sold),
            }))}
          />
        ) : (
          <div className="bg-paper border border-line rounded-card p-10 text-center">
            <div className="text-4xl">🕓</div>
            <h2 className="font-display text-xl font-semibold mt-3">Ordering is closed for this drop</h2>
            <p className="text-muted mt-2">
              You just missed it — or it hasn't opened yet. Follow {drop.seller.storeName} for the next one.
            </p>
            <Link
              href={`/s/${slug}`}
              className="inline-block mt-5 text-sm font-semibold rounded-pill px-5 py-2.5 text-white"
              style={{ backgroundColor: accent }}
            >
              Back to {drop.seller.storeName}
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
