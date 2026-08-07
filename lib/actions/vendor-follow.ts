"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentCustomer } from "@/lib/customer-auth";
import { recordRelationship, applyFirstTouch } from "@/lib/attribution";

export type FollowState = { following?: boolean; error?: string };

/**
 * Follow / unfollow a vendor.
 *
 * Unfollowing clears `followedAt` but keeps the CustomerVendor row — the
 * purchase history on it is a record of something that happened, and deleting
 * it would quietly rewrite the vendor's customer counts.
 *
 * Signed-out customers are sent to sign-in with a return path, so a follow
 * never dead-ends.
 */
export async function toggleVendorFollowAction(formData: FormData): Promise<void> {
  const sellerId = String(formData.get("sellerId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "") || "/dropmeet";

  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect(`/messages/login?next=${encodeURIComponent(returnTo)}`);
  }

  const seller = await prisma.seller.findFirst({
    where: { id: sellerId, disabledAt: null },
    select: { id: true },
  });
  if (!seller) return;

  const existing = await prisma.customerVendor.findUnique({
    where: { customerId_sellerId: { customerId: customer.id, sellerId } },
  });

  if (existing?.followedAt) {
    await prisma.customerVendor.update({
      where: { id: existing.id },
      data: { followedAt: null },
    });
  } else {
    // A follow is a legitimate first touch if they arrived with no other.
    await applyFirstTouch(customer.id, {
      vendorId: sellerId,
      source: "dropmeet",
      detail: "vendor_follow",
    });
    await recordRelationship({
      customerId: customer.id,
      sellerId,
      source: existing ? existing.relationshipSource : "follow",
      follow: true,
    });
  }

  revalidatePath(returnTo);
}
