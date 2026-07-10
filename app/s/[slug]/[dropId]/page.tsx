import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isStripeEnabled, feePercent } from "@/lib/stripe";
import { StorefrontOrder } from "@/components/storefront-order";
import { WaitlistForm } from "@/components/waitlist-form";
import { computeDropPhase, isOrderingOpen } from "@/lib/drop-status";
import { formatPickupWindow, pickupLocation } from "@/lib/pickup";
import { vendorPalette } from "@/lib/color";

// Absolute URL for link-preview images (blob URLs are already absolute).
function absUrl(u?: string | null): string | null {
  if (!u) return null;
  return u.startsWith("http") ? u : `https://www.drop-q.com${u.startsWith("/") ? "" : "/"}${u}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; dropId: string }>;
}) {
  const { slug, dropId } = await params;
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    select: {
      title: true,
      description: true,
      products: { where: { imageUrl: { not: null } }, orderBy: { sortOrder: "asc" }, take: 1, select: { imageUrl: true } },
      seller: {
        select: { storeName: true, tagline: true, logoUrl: true, headerImageUrl: true },
      },
    },
  });
  if (!drop) return { title: "Order" };

  const title = `${drop.title} — ${drop.seller.storeName}`;
  const description =
    drop.description || drop.seller.tagline || `Order “${drop.title}” from ${drop.seller.storeName}.`;
  // Prefer a product photo, then the store banner, then the logo.
  const image =
    absUrl(drop.products[0]?.imageUrl) ||
    absUrl(drop.seller.headerImageUrl) ||
    absUrl(drop.seller.logoUrl);
  const url = `https://www.drop-q.com/s/${slug}/${dropId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: drop.seller.storeName,
      url,
      type: "website",
      images: image ? [image] : [],
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : [],
    },
  };
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
  // Accessible CTA color derived from the vendor's brand color — used for
  // buttons/badges with white text so they stay readable even for light brands.
  const cta = vendorPalette(accent).vendor_cta_color;
  const tz = drop.seller.timezone;
  const isLiveDrop = drop.mode === "live";
  const phase = computeDropPhase(drop);
  const orderingOpen = isOrderingOpen(drop); // server-time gate for the order form
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

  const pickupWindow = formatPickupWindow(drop, tz);
  const pickupWhere = pickupLocation(drop);
  const opensAtLabel =
    drop.opensAt &&
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz || undefined,
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", timeZoneName: "short",
    }).format(drop.opensAt);

  // Pickup details block, reused in the open + closed states.
  const pickupBlock =
    pickupWindow || pickupWhere || drop.pickupNotes ? (
      <div className="bg-paper border border-line rounded-card p-5 mt-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {drop.fulfillment === "delivery" ? "Delivery" : "Pickup"} details
        </p>
        {pickupWindow && (
          <p className="mt-1.5 text-sm"><span className="font-medium">When:</span> {pickupWindow}</p>
        )}
        {pickupWhere && (
          <p className="mt-1 text-sm"><span className="font-medium">Where:</span> {pickupWhere}</p>
        )}
        {drop.pickupNotes && (
          <p className="mt-1 text-sm text-ink-soft"><span className="font-medium">Notes:</span> {drop.pickupNotes}</p>
        )}
      </div>
    ) : null;

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
                style={{ backgroundColor: cta }}
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
          {orderingOpen ? (
            <span
              style={{ backgroundColor: cta }}
              className="inline-flex items-center gap-1.5 text-white text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white live-dot" /> {isLiveDrop ? "Live now — order here" : "Ordering open"}
            </span>
          ) : phase === "scheduled" ? (
            <span className="inline-flex items-center gap-1.5 bg-quad/20 text-ink-soft text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill">
              Opens {opensAtLabel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 bg-line text-ink-soft text-xs font-semibold uppercase tracking-wide px-2.5 py-1 rounded-pill">
              {phase === "pickup" ? "Pickup available" : "Ordering closed"}
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

        {orderingOpen ? (
          <>
            <StorefrontOrder
              dropId={drop.id}
              accent={accent}
              paymentsEnabled={paymentsEnabled}
              live={isLiveDrop}
              closesAt={drop.closesAt ? drop.closesAt.toISOString() : null}
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
            {pickupBlock}
          </>
        ) : phase === "scheduled" ? (
          <div className="bg-paper border border-line rounded-card p-10 text-center">
            <div className="text-4xl">🗓️</div>
            <h2 className="font-display text-xl font-semibold mt-3">Ordering opens {opensAtLabel}</h2>
            <p className="text-muted mt-2">Get notified the moment it goes live.</p>
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
        ) : (
          <div>
            <div className="bg-paper border border-line rounded-card p-10 text-center">
              <div className="text-4xl">🔒</div>
              <h2 className="font-display text-xl font-semibold mt-3">
                This drop is closed. Orders are now locked in.
              </h2>
              <p className="text-muted mt-2">
                Ordering has ended for this drop. Follow {drop.seller.storeName} for the next one.
              </p>
              <Link
                href={`/s/${slug}`}
                className="inline-block mt-5 text-sm font-semibold rounded-pill px-5 py-2.5 text-white"
                style={{ backgroundColor: cta }}
              >
                Back to {drop.seller.storeName}
              </Link>
            </div>
            {pickupBlock}
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
