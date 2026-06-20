import { LinkButton, Button, Badge } from "@/components/ui";
import { ProWaitlistForm } from "@/components/pro-waitlist-form";
import { createGrowthCheckoutAction } from "@/lib/actions/billing";
import { PRICING, effectivePlan, type Plan } from "@/lib/plans";

type SellerLite = {
  email: string;
  plan: string;
  partnerExpiresAt: Date | null;
  subscriptionStatus: string | null;
} | null;

function Cta({ planId, seller }: { planId: Plan; seller: SellerLite }) {
  const current = seller
    ? effectivePlan({
        plan: seller.plan,
        partnerExpiresAt: seller.partnerExpiresAt,
        dropsCreated: 0,
      })
    : null;

  if (planId === "starter") {
    if (!seller) return <LinkButton href="/signup" variant="secondary" className="w-full">Start free</LinkButton>;
    if (current === "starter")
      return <span className="block text-center text-sm font-medium text-muted py-2.5">Your current plan</span>;
    return <span className="block text-center text-sm text-muted py-2.5">Included</span>;
  }

  if (planId === "growth") {
    if (!seller) return <LinkButton href="/signup?plan=growth" className="w-full">Get started</LinkButton>;
    if (current === "growth" || current === "partner")
      return (
        <span className="block text-center text-sm font-semibold text-white/90 py-2.5">
          {current === "partner" ? "Included with Partner" : "Your current plan"}
        </span>
      );
    return (
      <form action={createGrowthCheckoutAction}>
        <Button size="lg" className="w-full">Upgrade to Growth — $20/mo</Button>
      </form>
    );
  }

  // Pro — coming soon, never purchasable.
  return (
    <>
      <button
        type="button"
        disabled
        className="w-full inline-flex items-center justify-center font-medium rounded-xl text-base px-7 py-3.5 bg-line text-muted cursor-not-allowed"
      >
        Coming Soon
      </button>
      <ProWaitlistForm defaultEmail={seller?.email ?? ""} />
    </>
  );
}

export function PricingCards({ seller }: { seller: SellerLite }) {
  return (
    <div className="grid lg:grid-cols-3 gap-5 items-start">
      {PRICING.map((p) => {
        const featured = p.highlighted;
        return (
          <div
            key={p.id}
            className={`rounded-card p-6 flex flex-col h-full ${
              featured
                ? "bg-brand text-white shadow-[var(--shadow-lift)] lg:-mt-3 lg:mb-3"
                : "bg-paper border border-line"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`text-xs font-semibold uppercase tracking-[0.18em] ${featured ? "text-white/80" : "text-brand"}`}>
                {p.positioning}
              </span>
              {p.badge === "Most Popular" && <Badge className="bg-white/20 text-white">Most Popular</Badge>}
              {p.badge === "Coming Soon" && <Badge className="bg-quad/15 text-tertiary">Coming Soon</Badge>}
            </div>

            <h3 className={`font-display text-2xl font-semibold mt-3 ${featured ? "text-white" : ""}`}>{p.name}</h3>
            <div className="mt-1.5 mb-1">
              <span className="font-display text-4xl font-semibold">{p.price}</span>
              <span className={featured ? "text-white/75" : "text-muted"}>{p.cadence}</span>
            </div>
            <p className={`text-sm mb-5 ${featured ? "text-white/80" : "text-muted"}`}>{p.blurb}</p>

            <div className="mb-5">
              <Cta planId={p.id} seller={seller} />
            </div>

            <ul className="space-y-2.5 text-sm mt-auto">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span className={featured ? "text-white" : "text-brand"}>✓</span>
                  <span className={featured ? "text-white/90" : "text-ink-soft"}>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
