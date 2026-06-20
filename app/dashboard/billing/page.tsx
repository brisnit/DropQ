import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { finalizeGrowthCheckout } from "@/lib/billing";
import {
  effectivePlan,
  planLabel,
  dropsRemaining,
  isPartnerExpired,
  hasGrowthBonus,
  STARTER_DROP_LIMIT,
} from "@/lib/plans";
import { createGrowthCheckoutAction, manageBillingAction } from "@/lib/actions/billing";
import { Section, PageHeader } from "@/components/dashboard-ui";
import { Button, Badge } from "@/components/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Plan & billing — DropQ" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    upgraded?: string;
    session_id?: string;
    canceled?: string;
    already?: string;
    limit?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  // Webhook-independent activation when returning from Checkout.
  if (sp.session_id) await finalizeGrowthCheckout(sp.session_id);

  const seller = await requireSeller();
  const plan = effectivePlan(seller);
  const remaining = dropsRemaining(seller);
  // Growth via a referral bonus (not a paid subscription).
  const bonusOnly = seller.plan === "starter" && hasGrowthBonus(seller);
  const planColor: Record<string, string> = {
    starter: "bg-line text-ink-soft",
    growth: "bg-brand-tint text-brand-dark",
    partner: "bg-sage-tint text-sage",
    pro: "bg-quad/15 text-tertiary",
  };

  return (
    <Section>
      <PageHeader title="Plan & billing" subtitle="Manage your DropQ plan." />

      {sp.upgraded && (
        <p className="mb-5 text-sm bg-sage-tint text-sage rounded-lg px-3 py-2">
          🎉 You&apos;re on Growth — unlimited drops are unlocked.
        </p>
      )}
      {sp.limit && plan === "starter" && (
        <p className="mb-5 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          You&apos;ve used all {STARTER_DROP_LIMIT} Starter drops. Upgrade to Growth for unlimited drops.
        </p>
      )}
      {sp.canceled && (
        <p className="mb-5 text-sm bg-line text-ink-soft rounded-lg px-3 py-2">
          Checkout canceled — no changes were made.
        </p>
      )}
      {sp.already && (
        <p className="mb-5 text-sm bg-line text-ink-soft rounded-lg px-3 py-2">
          You&apos;re already on this plan.
        </p>
      )}
      {sp.error === "checkout" && (
        <p className="mb-5 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          Couldn&apos;t start checkout.{sp.detail ? ` Stripe says: ${sp.detail}` : ""}
        </p>
      )}
      {sp.error === "disabled" && (
        <p className="mb-5 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          Billing isn&apos;t enabled yet (no Stripe key configured).
        </p>
      )}
      {sp.error === "portal" && (
        <p className="mb-5 text-sm bg-brand-tint text-brand-dark rounded-lg px-3 py-2">
          Couldn&apos;t open the billing portal. Enable the Customer Portal in your Stripe settings.
        </p>
      )}

      {/* Current plan card */}
      <div className="bg-paper border border-line rounded-card p-6 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-display text-2xl font-semibold">{planLabel(plan)}</h2>
              <Badge className={planColor[plan]}>
                {plan === "growth" ? (bonusOnly ? "Free bonus" : "$20/mo") : plan === "pro" ? "$99/mo" : "Free"}
              </Badge>
            </div>
            <p className="text-muted text-sm mt-1">
              {plan === "starter" && `${remaining} of ${STARTER_DROP_LIMIT} lifetime drops remaining.`}
              {plan === "growth" &&
                (bonusOnly ? "Growth-level features from a referral bonus." : "Unlimited drops · billed monthly.")}
              {plan === "partner" && "Early Partner — unlimited drops, free for your first year."}
            </p>
          </div>

          <div className="flex gap-2">
            {(plan === "starter" || bonusOnly) && (
              <form action={createGrowthCheckoutAction}>
                <Button>Upgrade to Growth — $20/mo</Button>
              </form>
            )}
            {plan === "growth" && seller.stripeCustomerId && (
              <form action={manageBillingAction}>
                <Button variant="secondary">Manage billing</Button>
              </form>
            )}
          </div>
        </div>

        {/* Referral bonus notice */}
        {bonusOnly && seller.growthBonusUntil && (
          <div className="mt-4 text-sm rounded-xl bg-sage-tint text-sage px-4 py-3">
            🎁 Free Growth from referrals until <b>{formatDate(seller.growthBonusUntil)}</b>. Upgrade anytime to keep Growth after it ends.
          </div>
        )}

        {/* Partner expiry notice */}
        {seller.plan === "partner" && seller.partnerExpiresAt && (
          <div className="mt-4 text-sm rounded-xl bg-cream border border-line px-4 py-3">
            {isPartnerExpired(seller) ? (
              <>Your Partner year ended on <b>{formatDate(seller.partnerExpiresAt)}</b>. You&apos;re now on Growth — add billing to keep selling without interruption.</>
            ) : (
              <>Partner activated{seller.partnerActivatedAt ? ` ${formatDate(seller.partnerActivatedAt)}` : ""}. Free until <b>{formatDate(seller.partnerExpiresAt)}</b>, then automatically moves to Growth ($20/mo) unless changed.</>
            )}
          </div>
        )}

        {plan === "growth" && seller.subscriptionStatus === "past_due" && (
          <div className="mt-4 text-sm rounded-xl bg-brand-tint text-brand-dark px-4 py-3">
            Your last payment failed. Update your card in the billing portal to keep Growth active.
          </div>
        )}
      </div>

      <p className="text-sm text-muted">
        Want to compare every plan?{" "}
        <Link href="/pricing" className="text-brand font-medium hover:underline">
          See full pricing →
        </Link>
      </p>
    </Section>
  );
}
