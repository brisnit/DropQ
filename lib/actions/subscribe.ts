"use server";

import { prisma } from "@/lib/db";

export type SubscribeState = { ok?: boolean; error?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Loose phone check: 10+ digits after stripping formatting.
const PHONE_DIGITS = (s: string) => s.replace(/\D/g, "");

export async function subscribeAction(
  _prev: SubscribeState,
  formData: FormData
): Promise<SubscribeState> {
  const sellerId = String(formData.get("sellerId") ?? "");
  const dropId = String(formData.get("dropId") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  // Consent is collected per channel — never bundled. SMS marketing requires
  // express written consent (TCPA), so an unchecked optInSms means we must not
  // text this person, even if they opted into email.
  const optInEmail = formData.get("optInEmail") === "on";
  const optInSms = formData.get("optInSms") === "on";
  const optInNotifications = optInEmail || optInSms;
  const optInGeofence = formData.get("optInGeofence") === "on";

  if (!sellerId) return { error: "Something went wrong. Please try again." };
  if (!email && !phone) return { error: "Add an email or phone number so we can reach you." };
  if (email && !EMAIL_RE.test(email)) return { error: "That email doesn't look right." };
  if (phone && PHONE_DIGITS(phone).length < 10) return { error: "That phone number doesn't look right." };
  if (!optInNotifications) return { error: "Pick at least one way for us to reach you — email or text." };
  if (optInEmail && !email) return { error: "Add your email so we can send you drop alerts." };
  if (optInSms && !phone) return { error: "Add your mobile number so we can text you drop alerts." };

  const seller = await prisma.seller.findUnique({ where: { id: sellerId } });
  if (!seller) return { error: "Store not found." };

  // De-dupe: skip if this contact already signed up for this store.
  const existing = await prisma.subscriber.findFirst({
    where: {
      sellerId,
      OR: [email ? { email } : undefined, phone ? { phone } : undefined].filter(Boolean) as object[],
    },
  });
  if (existing) {
    await prisma.subscriber.update({
      where: { id: existing.id },
      data: {
        name: name ?? existing.name,
        email,
        phone,
        optInNotifications,
        optInEmail,
        optInSms,
        // Keep the original consent date if they're still opted in; clear it
        // outright if they've unchecked the box (consent revoked).
        smsConsentAt: optInSms ? existing.smsConsentAt ?? new Date() : null,
        optInGeofence,
        dropId,
      },
    });
    return { ok: true };
  }

  await prisma.subscriber.create({
    data: {
      sellerId,
      dropId,
      name,
      email,
      phone,
      optInNotifications,
      optInEmail,
      optInSms,
      smsConsentAt: optInSms ? new Date() : null,
      optInGeofence,
      source: "waitlist",
    },
  });
  return { ok: true };
}
