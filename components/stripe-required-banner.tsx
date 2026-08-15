import { prisma } from "@/lib/db";
import { sellerBlockReason, type SellerPaymentState } from "@/lib/payments";
import { LinkButton } from "@/components/ui";

/**
 * Vendor-facing notice for the governing platform rule: a DropQ vendor cannot
 * sell unless Stripe is connected and currently charge-ready.
 *
 * A server component, because sellability depends on STRIPE_SECRET_KEY, which
 * doesn't exist in the browser (see lib/payments.ts).
 *
 * Two failure modes, deliberately given different copy — they used to share a
 * single "finish setting up payments" message, which badly understated the
 * second:
 *
 *  - not_connected    onboarding was never finished. Expected, low urgency.
 *  - charges_disabled the vendor DID connect and Stripe has since turned
 *                     charges off. This arrives via the account.updated
 *                     webhook and can hit an established vendor mid-drop, so
 *                     it needs to read as the interruption it is.
 *
 * Escalates further when the vendor actually has a live drop, because then the
 * problem isn't hypothetical — a storefront is up that can't take money.
 */
export async function StripeRequiredBanner({
  seller,
}: {
  seller: SellerPaymentState & { id: string };
}) {
  const reason = sellerBlockReason(seller);
  if (!reason || reason === "suspended") return null; // suspended vendors can't reach the dashboard

  const liveDrops = await prisma.drop.count({
    where: { sellerId: seller.id, status: "live" },
  });
  const hasLive = liveDrops > 0;

  const copy =
    reason === "charges_disabled"
      ? {
          title: "⚠️ Payments are disabled on your Stripe account",
          body: hasLive
            ? `Stripe has turned off card payments for your account, so your ${
                liveDrops === 1 ? "live drop is" : `${liveDrops} live drops are`
              } not accepting orders. Resolve it in Stripe to start selling again.`
            : "Stripe has turned off card payments for your account. You can keep building drops, but you can't publish or sell until it's resolved.",
          cta: "Fix this in Stripe →",
        }
      : {
          title: "Connect Stripe to start selling",
          body: "DropQ takes payment by card through Stripe. Connect your account to publish a drop and get paid — it only takes a minute. You can build drops as drafts in the meantime.",
          cta: "Connect Stripe →",
        };

  // Charges-disabled on a live drop is an active outage for this vendor; the
  // onboarding case is just an unfinished step.
  const urgent = reason === "charges_disabled";

  return (
    <div
      className={`mb-6 rounded-card border p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 ${
        urgent ? "bg-brand-tint border-brand/40" : "bg-grey-tint border-line-strong"
      }`}
    >
      <div className="min-w-0">
        <p className="font-semibold text-ink">{copy.title}</p>
        <p className="text-sm text-ink-soft mt-0.5">{copy.body}</p>
      </div>
      <LinkButton href="/dashboard/payments" className="shrink-0">
        {copy.cta}
      </LinkButton>
    </div>
  );
}
