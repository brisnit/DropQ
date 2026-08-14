import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { linkOAuthCustomer } from "@/lib/customer-oauth";
import { createCustomerSession } from "@/lib/customer-auth";
import { applyFirstTouch } from "@/lib/attribution";

/**
 * Auth.js — CUSTOMER authentication only.
 *
 * A deliberate "front door": Auth.js handles the OAuth handshake, we resolve the
 * DropQ Customer, and then we mint the EXISTING `dq_customer` cookie. Every
 * existing customer session stays valid, all 24 getCurrentCustomer() call sites
 * keep working untouched, and magic link remains a peer login method.
 *
 * Vendor authentication (`hp_session`, lib/auth.ts) is not imported here and is
 * completely unaffected. Nothing in this file can invalidate a vendor session.
 *
 * JWT sessions, no Prisma adapter: the adapter would want its own `User` table,
 * which would compete with `Customer` as the customer identity. Auth.js's own
 * session is transient and unused after the handshake — `dq_customer` is the
 * session that matters.
 *
 * Adding Apple later = one more entry in `providers`. The linking logic in
 * lib/customer-oauth.ts is already provider-agnostic.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // Ask for the minimum. No contacts, no profile scopes beyond identity.
      authorization: { params: { scope: "openid email profile", prompt: "select_account" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/messages/login", error: "/messages/login" },
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || !profile) return false;

      // Google sets email_verified. Treated as false if absent — never assumed.
      const emailVerified = profile.email_verified === true;

      const result = await linkOAuthCustomer({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email: profile.email ?? null,
        emailVerified,
        name: (profile.name as string | undefined) ?? null,
      });

      if (!result.ok) {
        console.warn(`OAuth sign-in refused: ${result.reason} (${account.provider})`);
        return `/messages/login?error=${result.reason}`;
      }

      // Mint the DropQ session. This is the front door closing behind them.
      await createCustomerSession(result.customerId);
      // A new account gets attributed to whichever vendor sent them here.
      if (result.outcome === "created") await applyFirstTouch(result.customerId);

      return true;
    },
  },
});
