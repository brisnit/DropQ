"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { sendEmail, dropqTestEmail } from "@/lib/email";
import { sendSms } from "@/lib/notifications";
import { partnerExpiryFrom, type Plan } from "@/lib/plans";

const PLANS: Plan[] = ["starter", "growth", "partner", "pro"];

/** Admin: send a one-off test email to your own address to confirm delivery. */
export async function sendTestEmailAction() {
  const me = await requireAdmin();
  const res = await sendEmail(dropqTestEmail(me.email));
  const params = res.ok
    ? "test=sent"
    : `test=fail&testmsg=${encodeURIComponent(res.skipped ? "RESEND_API_KEY is not set — email was logged to the server console, not sent." : res.error || "Unknown error")}`;
  redirect(`/admin?${params}`);
}

/** Admin: send a one-off test SMS to a number to confirm Twilio delivery. */
export async function sendTestSmsAction(formData: FormData) {
  await requireAdmin();
  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) redirect("/admin?sms=fail&smsmsg=" + encodeURIComponent("Enter a phone number."));
  const res = await sendSms(phone, "DropQ test message ✅ — if you got this, SMS is working.");
  const params = res.ok
    ? `sms=sent&smsmsg=${encodeURIComponent(`SID ${res.sid ?? "?"} · status ${res.providerStatus ?? "queued"}`)}`
    : `sms=fail&smsmsg=${encodeURIComponent(res.skipped ? "Twilio is not configured (set TWILIO_* env vars)." : res.error || "Unknown error")}`;
  redirect(`/admin?${params}`);
}

/** Admin: change a vendor's plan. Assigning Partner (re)starts the 12-month clock. */
export async function setPlanAction(formData: FormData) {
  await requireAdmin();
  const targetId = String(formData.get("targetId") ?? "");
  const plan = String(formData.get("plan") ?? "") as Plan;
  if (!targetId || !PLANS.includes(plan)) return;

  const data: {
    plan: Plan;
    partnerActivatedAt?: Date;
    partnerExpiresAt?: Date | null;
  } = { plan };
  if (plan === "partner") {
    const now = new Date();
    data.partnerActivatedAt = now;
    data.partnerExpiresAt = partnerExpiryFrom(now);
  }
  await prisma.seller.update({ where: { id: targetId }, data });
  revalidatePath(`/admin/${targetId}`);
  revalidatePath("/admin");
  redirect(`/admin/${targetId}?plan=updated`);
}

/** Grant or revoke admin for a specific client. Admins only. */
export async function setAdminAction(formData: FormData) {
  const me = await requireAdmin();
  const targetId = String(formData.get("targetId") ?? "");
  const makeAdmin = String(formData.get("makeAdmin")) === "true";
  if (!targetId) return;
  // Don't let an admin remove their own access (avoids lockout).
  if (targetId === me.id && !makeAdmin) return;

  await prisma.seller.update({ where: { id: targetId }, data: { isAdmin: makeAdmin } });
  revalidatePath(`/admin/${targetId}`);
  revalidatePath("/admin");
}

/** Suspend or un-suspend a vendor (admins only). Suspending blocks login + storefront. */
export async function setSellerDisabledAction(formData: FormData) {
  const me = await requireAdmin();
  const targetId = String(formData.get("targetId") ?? "");
  const disable = String(formData.get("disable")) === "true";
  if (!targetId || (targetId === me.id && disable)) return; // never suspend yourself
  await prisma.seller.update({
    where: { id: targetId },
    data: { disabledAt: disable ? new Date() : null },
  });
  revalidatePath(`/admin/${targetId}`);
  revalidatePath("/admin");
  redirect(`/admin/${targetId}?suspend=${disable ? "on" : "off"}`);
}

/** Permanently delete a vendor and everything they own (admins only). */
export async function deleteVendorAction(formData: FormData) {
  const me = await requireAdmin();
  const targetId = String(formData.get("targetId") ?? "");
  if (!targetId || targetId === me.id) return; // never delete yourself
  // Cascades to the vendor's drops, products, orders, reviews, subscribers, etc.
  await prisma.seller.delete({ where: { id: targetId } });
  revalidatePath("/admin");
  redirect("/admin?deleted=1");
}

/** Grant admin to an account by email (from the admin home). */
export async function grantAdminByEmailAction(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) redirect("/admin?admin=missing");

  const seller = await prisma.seller.findUnique({ where: { email } });
  if (!seller) redirect(`/admin?admin=notfound&email=${encodeURIComponent(email)}`);

  await prisma.seller.update({ where: { id: seller.id }, data: { isAdmin: true } });
  revalidatePath("/admin");
  redirect(`/admin?admin=granted&email=${encodeURIComponent(email)}`);
}
