import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStripe, isStripeEnabled, feePercent } from "@/lib/stripe";
import {
  connectStripeAction,
  refreshStripeStatusAction,
  stripeDashboardAction,
} from "@/lib/actions/stripe";
import { formatMoney } from "@/lib/format";
import { PageHeader, Stat, Section } from "@/components/dashboard-ui";
import { Button, Badge } from "@/components/ui";

export const metadata = { title: "Payments — DropQ" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const seller = await requireSeller();
  const sp = await searchParams;
  const stripeEnabled = isStripeEnabled();
  const fee = feePercent();

  // Live-refresh connection status when we have an account.
  let chargesEnabled = seller.stripeChargesEnabled;
  let detailsSubmitted = false;
  if (stripeEnabled && seller.stripeAccountId) {
    try {
      const stripe = getStripe()!;
      const acct = await stripe.accounts.retrieve(seller.stripeAccountId);
      chargesEnabled = !!acct.charges_enabled;
      detailsSubmitted = !!acct.details_submitted;
      if (chargesEnabled !== seller.stripeChargesEnabled) {
        await prisma.seller.update({
          where: { id: seller.id },
          data: { stripeChargesEnabled: chargesEnabled },
        });
      }
    } catch {
      /* ignore transient Stripe errors; fall back to stored flag */
    }
  }

  // Payout summary (exclude unpaid/canceled)
  const paid = await prisma.order.aggregate({
    where: { sellerId: seller.id, status: { in: ["new", "ready", "fulfilled"] } },
    _sum: { totalCents: true, feeCents: true },
    _count: true,
  });
  const gross = paid._sum.totalCents ?? 0;
  const fees = paid._sum.feeCents ?? 0;

  const connected = !!seller.stripeAccountId;

  return (
    <Section>
      <PageHeader
        title="Payments"
        subtitle="Connect Stripe to accept card payments. Money goes straight to your account."
      />

      {sp.connected && (
        <div className="mb-5 rounded-xl bg-sage-tint text-sage px-4 py-3 text-sm">
          Thanks! We refreshed your Stripe status below.
        </div>
      )}

      {sp.error === "connect" && (
        <div className="mb-5 rounded-xl bg-brand-tint text-brand-dark px-4 py-3 text-sm">
          <b>Couldn&apos;t start Stripe onboarding.</b> This usually means Stripe
          <b> Connect isn&apos;t enabled</b> on the platform yet, or the Stripe key is invalid.
          Try again shortly — if it keeps failing, the platform needs to enable Connect in Stripe.
        </div>
      )}
      {sp.error === "disabled" && (
        <div className="mb-5 rounded-xl bg-brand-tint text-brand-dark px-4 py-3 text-sm">
          Payments aren&apos;t turned on for DropQ yet. Hang tight — this will be enabled soon.
        </div>
      )}
      {sp.error === "dashboard" && (
        <div className="mb-5 rounded-xl bg-brand-tint text-brand-dark px-4 py-3 text-sm">
          Couldn&apos;t open your Stripe dashboard right now. Please try again in a moment.
        </div>
      )}

      {/* Payout stats */}
      <div className="grid grid-cols-3 gap-4 mb-7">
        <Stat label="Paid orders" value={String(paid._count)} />
        <Stat label="Gross sales" value={formatMoney(gross)} sub="Before fees" />
        <Stat label={`DropQ fee (${fee}%)`} value={formatMoney(fees)} sub="Total to date" />
      </div>

      {/* Connection card */}
      {!stripeEnabled ? (
        <div className="bg-paper border border-line rounded-card p-6">
          <Badge className="bg-grey-tint text-[#3f434b] mb-3">Demo mode</Badge>
          <h2 className="font-semibold text-lg">Payments aren&apos;t configured yet</h2>
          <p className="text-muted mt-2 max-w-xl">
            This DropQ instance has no Stripe keys, so checkout runs in demo mode (orders
            complete instantly with no real charge). Add{" "}
            <code className="text-ink bg-cream px-1.5 py-0.5 rounded">STRIPE_SECRET_KEY</code>{" "}
            and{" "}
            <code className="text-ink bg-cream px-1.5 py-0.5 rounded">STRIPE_WEBHOOK_SECRET</code>{" "}
            to <code className="text-ink bg-cream px-1.5 py-0.5 rounded">.env</code> and restart
            to turn on real card payments.
          </p>
        </div>
      ) : connected && chargesEnabled ? (
        <div className="bg-paper border border-line rounded-card p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <Badge className="bg-sage-tint text-sage mb-2">● Connected</Badge>
              <h2 className="font-semibold text-lg">You&apos;re ready to accept payments</h2>
              <p className="text-muted mt-1 max-w-xl">
                Card payments go straight to your Stripe account and pay out to your
                bank on your schedule. DropQ keeps a{" "}
                <span className="text-ink font-medium">{fee}%</span> fee per order —
                no monthly cost. Standard Stripe card-processing fees also apply, just
                like anywhere you take card payments.
              </p>
            </div>
            <form action={stripeDashboardAction}>
              <Button type="submit" variant="secondary">Open Stripe dashboard ↗</Button>
            </form>
          </div>
        </div>
      ) : connected && !chargesEnabled ? (
        <div className="bg-paper border border-line rounded-card p-6">
          <Badge className="bg-grey-tint text-[#3f434b] mb-2">Setup incomplete</Badge>
          <h2 className="font-semibold text-lg">Finish connecting your account</h2>
          <p className="text-muted mt-1 max-w-xl">
            {detailsSubmitted
              ? "Stripe is reviewing your details. This can take a few minutes."
              : "You started onboarding but Stripe still needs a few details before you can get paid."}
          </p>
          <div className="flex gap-2 mt-4">
            <form action={connectStripeAction}>
              <Button type="submit">Continue setup</Button>
            </form>
            <form action={refreshStripeStatusAction}>
              <Button type="submit" variant="secondary">Refresh status</Button>
            </form>
          </div>
        </div>
      ) : (
        <div className="bg-ink text-cream rounded-card p-7">
          <div className="max-w-xl">
            <h2 className="font-display text-2xl font-semibold">Get paid for your drops</h2>
            <p className="text-cream/75 mt-2">
              Connect a Stripe account to accept credit cards at checkout. Payouts land in your
              bank automatically. DropQ keeps a small{" "}
              <span className="text-white font-medium">{fee}%</span> fee per transaction — no
              monthly cost.
            </p>
            <form action={connectStripeAction} className="mt-5">
              <Button type="submit" size="lg">Connect with Stripe</Button>
            </form>
            <p className="text-xs text-cream/50 mt-3">
              You&apos;ll be redirected to Stripe to securely set up payouts.
            </p>
          </div>
        </div>
      )}

      <p className="text-xs text-muted mt-4">
        Platform fee is configurable via{" "}
        <code className="bg-paper border border-line px-1.5 py-0.5 rounded">DROPQ_FEE_PERCENT</code>.
      </p>
    </Section>
  );
}
