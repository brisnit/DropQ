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
import { StripeMark } from "@/components/stripe-mark";

export const metadata = { title: "Payments — DropQ" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; detail?: string }>;
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
    where: { sellerId: seller.id, status: { in: ["new", "in_progress", "ready", "completed", "fulfilled"] } },
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
          {sp.detail && (
            <span className="block mt-1 font-mono text-xs opacity-80">Stripe says: {sp.detail}</span>
          )}
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
        <div className="bg-sage-tint/50 border-2 border-sage/30 rounded-card p-6 sm:p-7 shadow-[var(--shadow-lift)]">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-sage text-white grid place-items-center text-xl shrink-0">✓</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge className="bg-sage text-white">Connected</Badge>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                    <StripeMark size={18} /> Powered by Stripe
                  </span>
                </div>
                <h2 className="font-display text-xl font-semibold mt-2">Payments are connected</h2>
                <p className="text-ink-soft mt-1 max-w-xl">
                  Card payments go straight to your Stripe account and pay out to your bank on
                  your schedule. Manage payouts, balances, and bank details in Stripe. DropQ keeps
                  a <span className="text-ink font-medium">{fee}%</span> fee per order — no monthly cost.
                </p>
              </div>
            </div>
            <form action={stripeDashboardAction} className="shrink-0">
              <Button type="submit" size="lg">Open Stripe Dashboard ↗</Button>
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
        <div className="bg-paper border border-line rounded-card p-6 sm:p-7 shadow-[var(--shadow-soft)]">
          <div className="flex items-center gap-2 mb-3">
            <StripeMark />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Powered by Stripe</span>
          </div>
          <h2 className="font-display text-2xl font-semibold">How do you receive payments?</h2>
          <p className="text-ink-soft mt-2 max-w-2xl">
            DropQ uses Stripe, the industry-standard payment platform trusted by millions of
            businesses worldwide. Stripe securely processes payments and deposits funds directly
            into your bank account.
          </p>
          <p className="text-muted text-sm mt-3 max-w-2xl">
            If you don&apos;t already have a Stripe account, you&apos;ll need to create one before you
            can receive payments through DropQ. DropQ keeps a small{" "}
            <span className="text-ink font-medium">{fee}%</span> fee per order — no monthly cost.
          </p>
          <p className="mt-4 max-w-2xl bg-brand-tint text-ink font-semibold rounded-xl px-4 py-3">
            Select &ldquo;Connect with Stripe&rdquo; and enter your email to get started.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            <form action={connectStripeAction}>
              <Button type="submit" size="lg">Connect with Stripe</Button>
            </form>
            <a
              href="https://stripe.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[0.95rem] font-medium px-5 py-2.5 rounded-xl border border-line-strong bg-paper hover:bg-cream hover:border-ink/30 transition"
            >
              Learn More About Stripe ↗
            </a>
          </div>
          <p className="text-xs text-muted mt-3">
            You&apos;ll be securely redirected to Stripe to create a new account or connect an
            existing one and set up payouts.
          </p>
        </div>
      )}

      <p className="text-xs text-muted mt-4">
        Platform fee is configurable via{" "}
        <code className="bg-paper border border-line px-1.5 py-0.5 rounded">DROPQ_FEE_PERCENT</code>.
      </p>
    </Section>
  );
}
