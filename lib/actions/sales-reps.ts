"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { generateReferralCode, normalizeCode } from "@/lib/commission";
import { sendSalesRepInvite } from "@/lib/sales-rep-invite";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Parse a percent input (e.g. "1" or "1.5") into a rate fraction (0.015). */
function parseRate(raw: string): number {
  const pct = parseFloat(String(raw ?? "").trim());
  if (!isFinite(pct) || pct < 0) return 0.01;
  return Math.min(pct, 100) / 100;
}

export async function createSalesRepAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const rate = parseRate(String(formData.get("commissionPercent") ?? "1"));
  let code = normalizeCode(String(formData.get("referralCode") ?? ""));

  if (!name) redirect("/admin/sales-reps?error=Enter+a+name");
  if (!EMAIL_RE.test(email)) redirect("/admin/sales-reps?error=Enter+a+valid+email");

  if (await prisma.salesRep.findUnique({ where: { email } })) {
    redirect("/admin/sales-reps?error=A+rep+with+that+email+already+exists");
  }
  if (code) {
    if (await prisma.salesRep.findUnique({ where: { referralCode: code } })) {
      redirect("/admin/sales-reps?error=That+referral+code+is+taken");
    }
  } else {
    code = await generateReferralCode(name);
  }

  const rep = await prisma.salesRep.create({
    data: { name, email, phone, referralCode: code, commissionRate: rate, status: "active" },
  });
  // Auto-send the invite (email + SMS) so the rep gets their code/link + how to
  // activate their dashboard. Redirect reflects whether email delivery worked.
  const invite = await sendSalesRepInvite(rep.id);
  revalidatePath("/admin/sales-reps");
  redirect(`/admin/sales-reps/${rep.id}?created=1&invite=${invite.emailOk ? "sent" : "failed"}`);
}

/** Resend the invite email/SMS to a rep (retry). */
export async function sendInviteAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const rep = await prisma.salesRep.findUnique({ where: { id } });
  if (!rep) redirect("/admin/sales-reps");
  const invite = await sendSalesRepInvite(id);
  redirect(`/admin/sales-reps/${id}?invite=${invite.emailOk ? "sent" : "failed"}`);
}

export async function updateSalesRepAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const rep = await prisma.salesRep.findUnique({ where: { id } });
  if (!rep) redirect("/admin/sales-reps");

  const name = String(formData.get("name") ?? "").trim() || rep.name;
  const email = String(formData.get("email") ?? "").trim().toLowerCase() || rep.email;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const rate = parseRate(String(formData.get("commissionPercent") ?? String(rep.commissionRate * 100)));
  const status = String(formData.get("status") ?? rep.status) === "inactive" ? "inactive" : "active";
  const codeInput = normalizeCode(String(formData.get("referralCode") ?? ""));
  const code = codeInput || rep.referralCode;

  if (!EMAIL_RE.test(email)) redirect(`/admin/sales-reps/${id}?error=Enter+a+valid+email`);
  // Uniqueness checks (exclude self).
  const emailOwner = await prisma.salesRep.findUnique({ where: { email } });
  if (emailOwner && emailOwner.id !== id) redirect(`/admin/sales-reps/${id}?error=Email+in+use`);
  const codeOwner = await prisma.salesRep.findUnique({ where: { referralCode: code } });
  if (codeOwner && codeOwner.id !== id) redirect(`/admin/sales-reps/${id}?error=Referral+code+taken`);

  await prisma.salesRep.update({
    where: { id },
    data: { name, email, phone, referralCode: code, commissionRate: rate, status },
  });
  revalidatePath("/admin/sales-reps");
  revalidatePath(`/admin/sales-reps/${id}`);
  redirect(`/admin/sales-reps/${id}?saved=1`);
}

/** Set (or reset) the rep's portal password — enables their read-only login. */
export async function setRepPasswordAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  const rep = await prisma.salesRep.findUnique({ where: { id } });
  if (!rep) redirect("/admin/sales-reps");
  if (password.length < 8) redirect(`/admin/sales-reps/${id}?error=Password+must+be+8%2B+characters`);
  await prisma.salesRep.update({ where: { id }, data: { passwordHash: await hashPassword(password) } });
  redirect(`/admin/sales-reps/${id}?pwset=1`);
}

export async function deleteSalesRepAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  // Vendors keep existing (salesRepId → null via SetNull); commissions cascade.
  await prisma.salesRep.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin/sales-reps");
  redirect("/admin/sales-reps?deleted=1");
}

/** Admin: set or clear a vendor's sales-rep attribution from the vendor page. */
export async function setVendorSalesRepAction(formData: FormData) {
  await requireAdmin();
  const vendorId = String(formData.get("vendorId") ?? "");
  const salesRepId = String(formData.get("salesRepId") ?? "").trim() || null;
  if (!vendorId) redirect("/admin");
  if (salesRepId) {
    const rep = await prisma.salesRep.findUnique({ where: { id: salesRepId }, select: { referralCode: true } });
    if (!rep) redirect(`/admin/${vendorId}?error=Unknown+rep`);
    await prisma.seller.update({
      where: { id: vendorId },
      data: { salesRepId, referralCodeUsed: rep.referralCode, referredAt: new Date() },
    });
  } else {
    await prisma.seller.update({
      where: { id: vendorId },
      data: { salesRepId: null, referralCodeUsed: null, referredAt: null },
    });
  }
  revalidatePath(`/admin/${vendorId}`);
  redirect(`/admin/${vendorId}?attributed=1`);
}

/* ------------------------------ Commissions ----------------------------- */

export async function markCommissionPaidAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const back = String(formData.get("back") ?? "/admin/commissions");
  await prisma.commissionLedger.updateMany({
    where: { id, status: { in: ["pending", "approved"] } },
    data: { status: "paid", paidAt: new Date() },
  });
  revalidatePath(back);
  redirect(back);
}

export async function voidCommissionAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const back = String(formData.get("back") ?? "/admin/commissions");
  await prisma.commissionLedger.updateMany({
    where: { id, status: { in: ["pending", "approved"] } },
    data: { status: "voided", voidedAt: new Date(), notes: "Voided by admin" },
  });
  revalidatePath(back);
  redirect(back);
}

/** Bulk: mark every unpaid (pending/approved) commission for a rep as paid. */
export async function bulkMarkRepPaidAction(formData: FormData) {
  await requireAdmin();
  const salesRepId = String(formData.get("salesRepId") ?? "");
  const back = String(formData.get("back") ?? `/admin/sales-reps/${salesRepId}`);
  await prisma.commissionLedger.updateMany({
    where: { salesRepId, status: { in: ["pending", "approved"] } },
    data: { status: "paid", paidAt: new Date() },
  });
  revalidatePath(back);
  redirect(`${back}?bulkpaid=1`);
}
