import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { PricingCards } from "@/components/pricing-cards";
import { getCurrentSeller } from "@/lib/auth";

export const metadata = {
  title: "Pricing — DropQ",
  description: "Start free, run unlimited drops on Growth, and grow customers with Pro.",
};

export default async function PricingPage() {
  const seller = await getCurrentSeller();

  return (
    <main className="min-h-screen flex flex-col">
      <SiteNav />
      <section className="max-w-6xl mx-auto px-5 w-full py-16 sm:py-24 flex-1">
        <div className="max-w-2xl">
          <span className="inline-block text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Pricing
          </span>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight mt-3">
            Try DropQ. Run drops. Grow customers.
          </h1>
          <p className="text-lg text-ink-soft mt-4">
            Start free, upgrade when you&apos;re ready to sell more, and keep a simple
            2% transaction fee at every tier. No setup fees, cancel anytime.
          </p>
        </div>

        <div className="mt-12">
          <PricingCards
            seller={
              seller
                ? {
                    email: seller.email,
                    plan: seller.plan,
                    partnerExpiresAt: seller.partnerExpiresAt,
                    subscriptionStatus: seller.subscriptionStatus,
                  }
                : null
            }
          />
        </div>

        <p className="text-sm text-muted mt-8 max-w-2xl">
          Have an Early Partner invite code?{" "}
          <a href="/signup" className="text-brand font-medium hover:underline">
            Enter it at signup
          </a>{" "}
          to unlock the Partner plan — free for 12 months.
        </p>
      </section>
      <SiteFooter />
    </main>
  );
}
