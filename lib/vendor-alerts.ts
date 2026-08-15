import "server-only";
import { prisma } from "@/lib/db";
import { sendEmail, sellingPausedEmail } from "@/lib/email";

/**
 * Vendor-facing operational alerts.
 *
 * Header-free base URL: these run from webhooks, which have no useful request
 * context to derive a host from. Same approach as lib/checkout.ts.
 */
function baseUrl(): string {
  return process.env.APP_URL?.replace(/\/$/, "") || "https://www.drop-q.com";
}

/**
 * Tell a vendor that Stripe has turned off their card payments and selling is
 * paused.
 *
 * Called ONLY on the charge-ready -> not-charge-ready transition, which the
 * account.updated handler detects with a conditional updateMany. Stripe emits
 * account.updated constantly and retries webhooks, so calling this on every
 * event would spam vendors; the caller's atomic flip is what makes it
 * exactly-once.
 *
 * **Never throws.** A webhook that 500s gets retried by Stripe, but the flag
 * has already been flipped by then — so the retry detects no transition and
 * this alert would be silently skipped. Swallowing here keeps the webhook 200
 * and keeps the failure visible in logs instead of losing the notification to a
 * retry that can't fire it again.
 */
export async function notifyVendorSellingPaused(stripeAccountId: string): Promise<void> {
  try {
    const seller = await prisma.seller.findFirst({
      where: { stripeAccountId },
      select: { id: true, email: true, storeName: true, disabledAt: true },
    });
    if (!seller) return;
    // An admin-suspended vendor already can't sell and has been told why.
    if (seller.disabledAt) return;

    const liveDrops = await prisma.drop.count({
      where: { sellerId: seller.id, status: "live" },
    });

    // Operational breadcrumb — matches the dispute handler's logging style, and
    // makes the pause searchable in Vercel logs even if the email fails.
    console.error(
      `[stripe] charges disabled — vendor=${seller.storeName} (${seller.id}) ` +
        `account=${stripeAccountId} liveDrops=${liveDrops}`
    );

    const res = await sendEmail(
      sellingPausedEmail({
        to: seller.email,
        storeName: seller.storeName,
        liveDrops,
        paymentsLink: `${baseUrl()}/dashboard/payments`,
      })
    );
    // `skipped` just means no RESEND_API_KEY (local dev prints to the console),
    // which is not a failure worth logging as one.
    if (!res.ok && !res.skipped) {
      console.error(`notifyVendorSellingPaused: email failed for ${seller.id}:`, res.error);
    }
  } catch (e) {
    console.error("notifyVendorSellingPaused failed:", stripeAccountId, e);
  }
}
