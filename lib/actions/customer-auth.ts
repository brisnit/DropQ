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
import { consume, requestIp } from "@/lib/rate-limit";

export type MagicLinkState = { sent?: boolean; error?: string; devLink?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Email a customer a sign-in link.
 *
 * Always reports success, even for an address we've never seen. Telling a
 * stranger "no account with that email" would turn this form into an oracle for
 * whether someone shops with a given vendor.
 */
/**
 * Journeys where signing in is how someone JOINS, not how they return.
 *
 * Keep this list short and public-facing. Anything added here lets an
 * unauthenticated form create a Customer row for an arbitrary address — bounded
 * by the magic-link rate limits, but still a row, and Customer feeds the
 * platform's customer counts.
 */
const SIGNUP_DESTINATIONS = ["/dropmeet/add"] as const;

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

  // Consumed before the lookup so an unknown address costs the same budget as a
  // real one. Over the limit returns the same `sent: true` as everything else —
  // this response must never differ by whether an account exists.
  const ip = await requestIp();
  const gate = await consume("magicLink", { email, ip });
  if (!gate.allowed) return { sent: true };

  let customer = await prisma.customer.findUnique({ where: { email } });

  /**
   * A first-time visitor gets an account made for them — but only on the
   * journeys where that is the point.
   *
   * Everywhere else this action deliberately sends nothing to an unknown
   * address: /messages is an inbox, and you cannot have messages before you
   * have ordered. Silently doing nothing was right there.
   *
   * It was wrong for "add a place" on DropMeet. Anyone can suggest a market,
   * most of them have never ordered anything, and they were shown "check your
   * email" for an email that was never sent. The screen said one thing and the
   * system did another, which is the worst of the available behaviours.
   *
   * Gated on the DESTINATION rather than a flag from the form, so the set of
   * journeys that may create an account is written down in one place and
   * cannot be widened by changing a hidden input. The response stays identical
   * either way, so this reveals nothing about who already has an account.
   */
  if (!customer && SIGNUP_DESTINATIONS.some((d) => next === d || next.startsWith(d + "?"))) {
    customer = await prisma.customer
      .create({ data: { email } })
      .catch(async () =>
        // A racing request may have created it between the read and the write.
        prisma.customer.findUnique({ where: { email } })
      );
  }

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
