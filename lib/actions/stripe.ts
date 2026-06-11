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

/** Create (if needed) a Stripe Express account and send the seller to onboarding. */
export async function connectStripeAction() {
  const seller = await requireSeller();
  const stripe = getStripe();
  if (!stripe) redirect("/dashboard/payments?error=disabled");

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
  redirect(link.url);
}

/** Re-sync charges-enabled status from Stripe. */
export async function refreshStripeStatusAction() {
  const seller = await requireSeller();
  const stripe = getStripe();
  if (!stripe || !seller.stripeAccountId) redirect("/dashboard/payments");

  const account = await stripe.accounts.retrieve(seller.stripeAccountId);
  await prisma.seller.update({
    where: { id: seller.id },
    data: { stripeChargesEnabled: !!account.charges_enabled },
  });
  revalidatePath("/dashboard/payments");
  redirect("/dashboard/payments");
}

/** Open the Stripe Express dashboard for an onboarded seller. */
export async function stripeDashboardAction() {
  const seller = await requireSeller();
  const stripe = getStripe();
  if (!stripe || !seller.stripeAccountId) redirect("/dashboard/payments");
  const link = await stripe.accounts.createLoginLink(seller.stripeAccountId);
  redirect(link.url);
}
