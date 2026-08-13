"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  destroyCustomerSession,
  createMagicLinkToken,
  normalizeEmail,
} from "@/lib/customer-auth";
import { sendEmail, customerMagicLinkEmail } from "@/lib/email";
import { appUrl } from "@/lib/message-delivery";

export type MagicLinkState = { sent?: boolean; error?: string; devLink?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Email a customer a sign-in link.
 *
 * Always reports success, even for an address we've never seen. Telling a
 * stranger "no account with that email" would turn this form into an oracle for
 * whether someone shops with a given vendor.
 */
export async function requestMagicLinkAction(
  _prev: MagicLinkState,
  formData: FormData
): Promise<MagicLinkState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const next = String(formData.get("next") ?? "") || "/messages";
  // Opt-in captured with the request, applied on redemption.
  const followSellerId = String(formData.get("followSellerId") ?? "") || null;
  const wantsFollow = String(formData.get("follow") ?? "") === "on";

  if (!email || !EMAIL_RE.test(email)) return { error: "Enter the email you used to order." };

  const customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer) return { sent: true };

  try {
    // Only honour a follow for a vendor this person has actually dealt with —
    // otherwise a crafted form could follow arbitrary stores on their behalf.
    let intentSellerId: string | null = null;
    if (wantsFollow && followSellerId) {
      const dealtWith = await prisma.order.findFirst({
        where: { customerId: customer.id, sellerId: followSellerId },
        select: { id: true },
      });
      if (dealtWith) intentSellerId = followSellerId;
    }

    const raw = await createMagicLinkToken(customer.id, { followSellerId: intentSellerId });
    const link = `${appUrl()}/messages/verify?token=${raw}&next=${encodeURIComponent(next)}`;
    const res = await sendEmail(customerMagicLinkEmail(email, link));
    // In dev (no RESEND_API_KEY) surface the link so the flow is testable.
    if (res.skipped && process.env.NODE_ENV !== "production") {
      return { sent: true, devLink: link };
    }
  } catch (e) {
    console.error("requestMagicLinkAction failed:", e);
    return { error: "Couldn't send that link. Please try again." };
  }

  return { sent: true };
}

export async function customerLogoutAction(): Promise<void> {
  await destroyCustomerSession();
  redirect("/messages/login");
}
