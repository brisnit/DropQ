import "server-only";
import { prisma } from "@/lib/db";

/**
 * The ACTIVE sales rep tied to a seller — by explicit user link, or by matching
 * (lowercased) email. Returns null if none / inactive. This is the single
 * server-side gate for the in-dashboard Referral Dashboard; access is never
 * based on query params.
 */
export async function salesRepForSeller(seller: { id: string; email: string }) {
  return prisma.salesRep.findFirst({
    where: {
      status: "active",
      OR: [{ userId: seller.id }, { email: seller.email.toLowerCase() }],
    },
  });
}

/**
 * Activation: link a seller's auth account to a matching sales rep and stamp
 * inviteAcceptedAt. Called on signup/login. Idempotent and safe if no match.
 */
export async function linkSellerAsRep(seller: { id: string; email: string }) {
  const rep = await salesRepForSeller(seller);
  if (rep && rep.userId !== seller.id) {
    await prisma.salesRep
      .update({
        where: { id: rep.id },
        data: { userId: seller.id, inviteAcceptedAt: rep.inviteAcceptedAt ?? new Date() },
      })
      .catch(() => {}); // userId is unique — ignore rare races
  }
  return rep;
}
