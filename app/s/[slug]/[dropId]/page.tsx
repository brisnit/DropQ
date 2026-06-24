import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isStripeEnabled, feePercent } from "@/lib/stripe";
import { StorefrontOrder } from "@/components/storefront-order";
import { WaitlistForm } from "@/components/waitlist-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; dropId: string }>;
}) {
  const { dropId } = await params;
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    select: { title: true, seller: { select: { storeName: true } } },
  });
  return { title: drop ? `${drop.title} — ${drop.seller.storeName}` : "Order" };
}

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
  if (!drop || drop.seller.slug !== slug || drop.seller.disabledAt) notFound();

  const accent = drop.seller.accent || "#ff6268";
  const isLive = drop.status === "live";
  const isLiveDrop = drop.mode === "live";
  const paymentsEnabled =
    isStripeEnabled() && drop.seller.stripeChargesEnabled && !!drop.seller.stripeAccountId;
  const fulfillmentLabel =
    drop.fulfillment === "pickup"
      ? "Pickup"
      : drop.fulfillment === "delivery"
        ? "Local delivery"
        : drop.fulfillment === "handoff"
          ? "On-site / local handoff"
          : "Pickup";

  return (
    <main className="min-h-screen">
      {/* Top bar — the vendor's identity (no DropQ branding) */}
      <div className="border-b border-line bg-cream/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center">
          <Link href={`/s/${slug}`} className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition">
            <span aria-hidden className="text-muted text-base leading-none">←</span>
            {drop.seller.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={drop.seller.logoUrl}
                alt={drop.seller.storeName}
                className="w-8 h-8 rounded-lg object-cover border border-line shrink-0"
              />
            ) : (
              <span
                className="w-8 h-8 rounded-lg grid place-items-center font-display text-sm font-semibold text-white shrink-0"
                style={{ backgroundColor: accent }}
              >
                {drop.seller.storeName.charAt(0)}
              </span>
            )}
            <span className="font-display font-semibold truncate">{drop.seller.storeName}</span>
          </Link>
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
              <span className="w-1.5 h-1.5 rounded-full bg-white live-dot" /> {isLiveDrop ? "Live now — order here" : "Ordering open"}
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
            live={isLiveDrop}
            feeMode={drop.seller.feeMode}
            feePercent={feePercent()}
            products={drop.products.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              priceCents: p.priceCents,
              emoji: p.emoji,
              imageUrl: p.imageUrl,
              images: p.images?.length ? p.images : p.imageUrl ? [p.imageUrl] : [],
              remaining: Math.max(0, p.inventory - p.sold),
              productType: p.productType,
              condition: p.condition,
              rarity: p.rarity,
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
            <div className="mt-6 max-w-md mx-auto text-left">
              <WaitlistForm
                sellerId={drop.sellerId}
                dropId={drop.id}
                storeName={drop.seller.storeName}
                accent={accent}
                geofence={drop.seller.geofenceEnabled}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
