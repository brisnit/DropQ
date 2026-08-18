import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { connectStripeAction } from "@/lib/actions/stripe";
import { addGalleryImagesAction, deleteGalleryImageAction } from "@/lib/actions/dashboard";
import { isStripeEnabled, feePercent } from "@/lib/stripe";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { Button, Badge } from "@/components/ui";
import { StoreSettingsForm } from "@/components/store-settings-form";
import { GalleryUpload } from "@/components/gallery-upload";
import { ConfirmSubmit } from "@/components/confirm-submit";

export const metadata = { title: "Store — DropQ" };

export default async function StorePage() {
  const seller = await requireSeller();
  const stripeEnabled = isStripeEnabled();
  const fee = feePercent();
  const started = !!seller.stripeAccountId;
  const connected = seller.stripeChargesEnabled && started;
  const gallery = await prisma.galleryImage.findMany({
    where: { sellerId: seller.id },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <Section>
      <PageHeader
        title="Store settings"
        subtitle="This is what buyers see on your storefront."
        action={
          <Link
            href={`/s/${seller.slug}`}
            target="_blank"
            className="text-sm font-medium inline-flex items-center justify-center min-h-11 px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            View Your Store ↗
          </Link>
        }
      />

      {/* Payouts — connect Stripe to get paid */}
      <div className="mb-6 max-w-2xl">
        {!stripeEnabled ? (
          <div className="bg-paper border border-line rounded-card p-6">
            <h2 className="font-semibold text-lg">💳 Getting paid</h2>
            <p className="text-muted mt-1 text-sm">
              Card payments are being switched on for DropQ. Soon you&apos;ll connect
              your bank right here to accept payments and get paid directly.
            </p>
          </div>
        ) : connected ? (
          <div className="bg-paper border border-line rounded-card p-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <Badge className="bg-sage-tint text-sage mb-2">● Payouts connected</Badge>
              <h2 className="font-semibold text-lg">You can accept card payments</h2>
              <p className="text-muted mt-1 text-sm">
                Money goes to your bank via Stripe. DropQ keeps {fee}% per order.
              </p>
            </div>
            <Link
              href="/dashboard/payments"
              className="text-sm font-medium inline-flex items-center justify-center min-h-11 px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
            >
              Manage
            </Link>
          </div>
        ) : (
          <div className="bg-ink text-cream rounded-card p-6">
            <h2 className="font-display text-xl font-semibold">Get paid for your drops</h2>
            <p className="text-cream/75 mt-1.5 max-w-xl text-sm">
              Connect your bank through Stripe to accept credit cards at checkout.
              Payouts land in your account automatically. DropQ keeps a small{" "}
              <span className="text-white font-medium">{fee}%</span> per order — no
              monthly fee. You&apos;ll enter your details securely on Stripe.
            </p>
            <form action={connectStripeAction} className="mt-4">
              <Button type="submit" variant="brand">
                {started ? "Finish setting up payouts" : "Set up payouts"}
              </Button>
            </form>
          </div>
        )}
      </div>

      <StoreSettingsForm
        feePercent={fee}
        seller={{
          storeName: seller.storeName,
          slug: seller.slug,
          tagline: seller.tagline,
          bio: seller.bio,
          location: seller.location,
          logoUrl: seller.logoUrl,
          headerImageUrl: seller.headerImageUrl,
          accent: seller.accent,
          timezone: seller.timezone,
          instagram: seller.instagram,
          tiktok: seller.tiktok,
          twitter: seller.twitter,
          facebook: seller.facebook,
          youtube: seller.youtube,
          website: seller.website,
          feeMode: seller.feeMode,
          pickupContactPhone: seller.pickupContactPhone,
          pickupContactPref: seller.pickupContactPref,
          geofenceEnabled: seller.geofenceEnabled,
          latitude: seller.latitude,
          longitude: seller.longitude,
          geofenceRadiusM: seller.geofenceRadiusM,
        }}
      />

      {/* Photo gallery */}
      <div id="gallery" className="mt-6 max-w-2xl bg-paper border border-line rounded-card p-6 sm:p-8">
        <h2 className="font-semibold text-lg">Photo gallery</h2>
        <p className="text-muted text-sm mt-1">
          Show off your products, space, or past drops. These appear in a gallery on your storefront.
        </p>

        {gallery.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 mt-5">
            {gallery.map((img) => (
              <div key={img.id} className="relative group rounded-xl overflow-hidden border border-line aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" className="w-full h-full object-cover" />
                <form action={deleteGalleryImageAction} className="absolute top-1.5 right-1.5">
                  <input type="hidden" name="imageId" value={img.id} />
                  <ConfirmSubmit
                    message="Remove this photo from your gallery?"
                    className="w-11 h-11 rounded-full bg-ink/70 text-white grid place-items-center text-xs opacity-0 group-hover:opacity-100 transition hover:bg-brand"
                  >
                    ✕
                  </ConfirmSubmit>
                </form>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5">
          <GalleryUpload action={addGalleryImagesAction} />
        </div>
      </div>
    </Section>
  );
}
