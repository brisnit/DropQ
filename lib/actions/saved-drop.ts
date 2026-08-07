"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/customer-auth";

/**
 * Save / unsave a drop.
 *
 * Saving is not following and not consent — it's a bookmark. It records no
 * relationship with the vendor and grants no permission to contact anyone.
 *
 * Signed-out customers go to sign-in with a return path, so the save isn't
 * silently dropped; they land back where they were and can save again.
 */
export async function toggleSavedDropAction(formData: FormData): Promise<void> {
  const dropId = String(formData.get("dropId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "") || "/my/saved";

  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect(`/messages/login?next=${encodeURIComponent(returnTo)}`);
  }

  // Only a drop that actually exists, from a vendor who isn't suspended.
  const drop = await prisma.drop.findFirst({
    where: { id: dropId, seller: { disabledAt: null } },
    select: { id: true },
  });
  if (!drop) return;

  const existing = await prisma.savedDrop.findUnique({
    where: { customerId_dropId: { customerId: customer.id, dropId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.savedDrop.delete({ where: { id: existing.id } });
  } else {
    await prisma.savedDrop.create({ data: { customerId: customer.id, dropId } });
  }

  revalidatePath(returnTo);
  revalidatePath("/my/saved");
}

export async function isDropSaved(dropId: string): Promise<boolean> {
  const customer = await getCurrentCustomer();
  if (!customer) return false;
  const row = await prisma.savedDrop.findUnique({
    where: { customerId_dropId: { customerId: customer.id, dropId } },
    select: { id: true },
  });
  return !!row;
}
