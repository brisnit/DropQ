"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSeller, getCurrentSeller } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { createGrowthCheckoutUrl } from "@/lib/billing";
import { effectivePlan } from "@/lib/plans";

async function baseUrl(): Promise<string> {
  const env = process.env.APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host") ?? "localhost:3000"}`;
}

/**
 * Start a Stripe Checkout subscription for the paid "Basic" plan ($8/mo). Charged to
 * the vendor on the DropQ platform account (separate from Connect payouts).
 * redirect() stays OUTSIDE the try (it throws NEXT_REDIRECT by design).
 */
export async function createGrowthCheckoutAction() {
  const seller = await requireSeller();

  // Already entitled to Growth (paid, or via Partner) — nothing to buy.
  const plan = effectivePlan(seller);
  if (
    (plan === "growth" && seller.subscriptionStatus === "active") ||
    plan === "partner"
  ) {
    redirect("/dashboard/billing?already=1");
  }

  let url: string | null = null;
  let disabled = false;
  let errDetail = "";

  if (!getStripe()) {
    disabled = true;
  } else {
    try {
      const base = await baseUrl();
      url = await createGrowthCheckoutUrl(seller, {
        successUrl: `${base}/dashboard/billing?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${base}/dashboard/billing?canceled=1`,
      });
    } catch (e) {
      console.error("Growth checkout failed:", e);
      errDetail = e instanceof Error ? e.message : "Unknown error";
    }
  }

  if (disabled) redirect("/dashboard/billing?error=disabled");
  if (!url)
    redirect(`/dashboard/billing?error=checkout&detail=${encodeURIComponent(errDetail.slice(0, 300))}`);
  redirect(url);
}

/** Open the Stripe billing portal so a vendor can manage/cancel their plan. */
export async function manageBillingAction() {
  const seller = await requireSeller();
  let url: string | null = null;
  try {
    const stripe = getStripe();
    if (stripe && seller.stripeCustomerId) {
      const base = await baseUrl();
      const portal = await stripe.billingPortal.sessions.create({
        customer: seller.stripeCustomerId,
        return_url: `${base}/dashboard/billing`,
      });
      url = portal.url;
    }
  } catch (e) {
    console.error("Billing portal failed:", e);
  }
  redirect(url ?? "/dashboard/billing?error=portal");
}

export type WaitlistState = { joined?: boolean; error?: string };

/** Join the Pro waitlist (works for logged-out visitors and logged-in vendors). */
export async function joinProWaitlistAction(
  _prev: WaitlistState,
  formData: FormData
): Promise<WaitlistState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: "Enter a valid email." };

  const seller = await getCurrentSeller();
  try {
    await prisma.proWaitlist.upsert({
      where: { email },
      create: {
        email,
        sellerId: seller?.id ?? null,
        storeName: seller?.storeName ?? null,
      },
      update: {
        ...(seller?.id ? { sellerId: seller.id } : {}),
        ...(seller?.storeName ? { storeName: seller.storeName } : {}),
      },
    });
  } catch (e) {
    console.error("Pro waitlist join failed:", e);
    return { error: "Something went wrong — please try again." };
  }
  return { joined: true };
}
