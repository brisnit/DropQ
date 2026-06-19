"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

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
