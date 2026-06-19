import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { connectStripeAction } from "@/lib/actions/stripe";
import { isStripeEnabled, feePercent } from "@/lib/stripe";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { Button, Badge } from "@/components/ui";
import { StoreSettingsForm } from "@/components/store-settings-form";

export const metadata = { title: "Store — DropQ" };

export default async function StorePage() {
  const seller = await requireSeller();
  const stripeEnabled = isStripeEnabled();
  const fee = feePercent();
  const started = !!seller.stripeAccountId;
  const connected = seller.stripeChargesEnabled && started;

  return (
    <Section>
      <PageHeader
        title="Store settings"
        subtitle="This is what buyers see on your storefront."
        action={
          <Link
            href={`/s/${seller.slug}`}
            target="_blank"
            className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
          >
            View storefront ↗
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
              className="text-sm font-medium px-4 py-2.5 rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
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
              <Button type="submit">
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
          accent: seller.accent,
          feeMode: seller.feeMode,
          geofenceEnabled: seller.geofenceEnabled,
          latitude: seller.latitude,
          longitude: seller.longitude,
          geofenceRadiusM: seller.geofenceRadiusM,
        }}
      />
    </Section>
  );
}
