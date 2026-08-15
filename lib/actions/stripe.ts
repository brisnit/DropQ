"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Create (if needed) a Stripe Express account and send the seller to onboarding.
 * All Stripe calls are guarded so a bad key or Connect-not-enabled returns a
 * friendly error instead of crashing the page. (redirect() must stay OUTSIDE the
 * try/catch — it throws NEXT_REDIRECT, which is control flow, not an error.)
 */
export async function connectStripeAction() {
  const seller = await requireSeller();
  let onboardingUrl: string | null = null;
  let disabled = false;
  let errDetail = "";

  try {
    const stripe = getStripe();
    if (!stripe) {
      disabled = true;
    } else {
      let accountId = seller.stripeAccountId;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          email: seller.email,
          business_profile: { name: seller.storeName },
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
        });
        accountId = account.id;
        await prisma.seller.update({
          where: { id: seller.id },
          data: { stripeAccountId: accountId },
        });
      }
      const base = await baseUrl();
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${base}/dashboard/payments?refresh=1`,
        return_url: `${base}/dashboard/payments?connected=1`,
        type: "account_onboarding",
      });
      onboardingUrl = link.url;
    }
  } catch (e) {
    console.error("Stripe connect failed:", e);
    errDetail = e instanceof Error ? e.message : "Unknown error";
  }

  if (disabled) redirect("/dashboard/payments?error=disabled");
  if (!onboardingUrl)
    redirect(`/dashboard/payments?error=connect&detail=${encodeURIComponent(errDetail.slice(0, 300))}`);
  redirect(onboardingUrl);
}

/** Re-sync charges-enabled status from Stripe. */
export async function refreshStripeStatusAction() {
  const seller = await requireSeller();
  try {
    const stripe = getStripe();
    if (stripe && seller.stripeAccountId) {
      const account = await stripe.accounts.retrieve(seller.stripeAccountId);
      const chargesEnabled = !!account.charges_enabled;
      await prisma.seller.update({
        where: { id: seller.id },
        data: { stripeChargesEnabled: chargesEnabled },
      });
      // Stamp activation history if this is the first time we've seen them
      // charge-ready — the account.updated webhook usually gets here first, but
      // a vendor who hits "Refresh status" during a webhook delay should still
      // be recorded. Predicated on null so it can never overwrite the original.
      if (chargesEnabled) {
        await prisma.seller.updateMany({
          where: { id: seller.id, stripeChargesEnabledAt: null },
          data: { stripeChargesEnabledAt: new Date() },
        });
      }
    }
  } catch (e) {
    console.error("Stripe status refresh failed:", e);
  }
  revalidatePath("/dashboard/payments");
  redirect("/dashboard/payments");
}

/** Open the Stripe Express dashboard for an onboarded seller. */
export async function stripeDashboardAction() {
  const seller = await requireSeller();
  let url: string | null = null;
  try {
    const stripe = getStripe();
    if (stripe && seller.stripeAccountId) {
      const link = await stripe.accounts.createLoginLink(seller.stripeAccountId);
      url = link.url;
    }
  } catch (e) {
    console.error("Stripe dashboard link failed:", e);
  }
  redirect(url ?? "/dashboard/payments?error=dashboard");
}
