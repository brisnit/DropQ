import "server-only";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/customer-auth";

/**
 * Resolve an OAuth identity to a DropQ Customer.
 *
 * Provider-agnostic on purpose — adding Apple later is a new entry in the
 * providers array, not another customer-auth migration.
 *
 * Resolution order, and why:
 *
 *   1. (provider, providerAccountId) — the provider's stable subject id. This
 *      is checked FIRST so a customer who later changes their Google email
 *      still lands on the same DropQ account.
 *   2. Verified email → existing Customer. This is what lets someone who has
 *      only ever used magic links sign in with Google and find their orders.
 *   3. Otherwise create a new Customer.
 *
 * SECURITY: step 2 requires the provider to assert the email is *verified*. An
 * unverified email must never claim an existing account — otherwise anyone
 * could register an OAuth identity carrying someone else's address and take
 * over their orders. Unverified sign-ins are refused outright rather than
 * silently creating a second account.
 */

export type OAuthIdentity = {
  provider: string;
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
  name?: string | null;
};

export type LinkOutcome =
  | { ok: true; customerId: string; outcome: "existing_link" | "linked_by_email" | "created" }
  | { ok: false; reason: "unverified_email" | "no_email" };

export async function linkOAuthCustomer(id: OAuthIdentity): Promise<LinkOutcome> {
  // 1. Known provider identity — the cheapest and most reliable match.
  const existingLink = await prisma.customerAccount.findUnique({
    where: { provider_providerAccountId: { provider: id.provider, providerAccountId: id.providerAccountId } },
    select: { id: true, customerId: true },
  });

  if (existingLink) {
    await prisma.customerAccount.update({
      where: { id: existingLink.id },
      data: { lastLoginAt: new Date() },
    });
    return { ok: true, customerId: existingLink.customerId, outcome: "existing_link" };
  }

  const email = id.email ? normalizeEmail(id.email) : null;
  if (!email) return { ok: false, reason: "no_email" };
  // Never let an unverified address claim an existing DropQ account.
  if (!id.emailVerified) return { ok: false, reason: "unverified_email" };

  // 2. Verified email matches an account they already have.
  const existingCustomer = await prisma.customer.findUnique({
    where: { email },
    select: { id: true, name: true },
  });

  if (existingCustomer) {
    await prisma.customerAccount.create({
      data: {
        customerId: existingCustomer.id,
        provider: id.provider,
        providerAccountId: id.providerAccountId,
        providerEmail: email,
        lastLoginAt: new Date(),
      },
    });
    // Fill a missing name opportunistically; never overwrite one they set.
    if (!existingCustomer.name && id.name) {
      await prisma.customer.update({
        where: { id: existingCustomer.id },
        data: { name: id.name.trim() },
      });
    }
    return { ok: true, customerId: existingCustomer.id, outcome: "linked_by_email" };
  }

  // 3. Brand new customer.
  const created = await prisma.customer.create({
    data: { email, name: id.name?.trim() || null },
  });
  await prisma.customerAccount.create({
    data: {
      customerId: created.id,
      provider: id.provider,
      providerAccountId: id.providerAccountId,
      providerEmail: email,
      lastLoginAt: new Date(),
    },
  });
  return { ok: true, customerId: created.id, outcome: "created" };
}
