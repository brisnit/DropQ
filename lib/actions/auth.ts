"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
  requireSeller,
} from "@/lib/auth";
import { slugify } from "@/lib/format";
import { createToken, consumeToken } from "@/lib/tokens";
import { sendEmail, verificationEmail, resetEmail } from "@/lib/email";
import { TERMS_VERSION } from "@/lib/terms";

export type AuthState = { error?: string };
export type ResetState = { error?: string; sent?: boolean; done?: boolean };

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = process.env.APP_URL?.replace(/\/$/, "") ?? null;
  if (host) return host;
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host") ?? "localhost:3000"}`;
}

async function sendVerification(sellerId: string, email: string) {
  const token = await createToken(sellerId, "verify");
  const link = `${await baseUrl()}/verify?token=${token}`;
  await sendEmail(verificationEmail(email, link));
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "store";
  let candidate = root;
  let n = 2;
  while (await prisma.seller.findUnique({ where: { slug: candidate } })) {
    candidate = `${root}-${n++}`;
  }
  return candidate;
}

export async function signupAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const storeName = String(formData.get("storeName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const acceptTerms = formData.get("acceptTerms") === "on";

  if (!storeName) return { error: "Give your store a name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: "Enter a valid email." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };
  if (!acceptTerms)
    return { error: "Please read and accept the Vendor Agreement to create a store." };

  const existing = await prisma.seller.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const seller = await prisma.seller.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      storeName,
      slug: await uniqueSlug(storeName),
      termsAcceptedAt: new Date(),
      termsVersion: TERMS_VERSION,
    },
  });

  // Send the verification email in the background so signup feels instant.
  after(() => sendVerification(seller.id, seller.email));
  await createSession(seller.id);
  redirect("/dashboard");
}

export async function loginAction(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const seller = await prisma.seller.findUnique({ where: { email } });
  if (!seller || !(await verifyPassword(password, seller.passwordHash))) {
    return { error: "Wrong email or password." };
  }

  await createSession(seller.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/");
}

/** Record that the current vendor accepted the Vendor Agreement. */
export async function acceptTermsAction(): Promise<void> {
  const seller = await requireSeller();
  await prisma.seller.update({
    where: { id: seller.id },
    data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
  });
  // Bust the cached dashboard layout (it renders the gate) so it re-reads the
  // now-accepted seller and the gate disappears.
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard");
}

/** Resend the verification email to the logged-in seller. */
export async function resendVerificationAction(): Promise<void> {
  const seller = await requireSeller();
  if (!seller.emailVerified) {
    await sendVerification(seller.id, seller.email);
  }
  redirect("/dashboard?verifysent=1");
}

/** Forgot-password: email a reset link. Never reveals whether an account exists. */
export async function requestPasswordResetAction(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: "Enter a valid email." };

  const seller = await prisma.seller.findUnique({ where: { email } });
  if (seller) {
    const token = await createToken(seller.id, "reset");
    const link = `${await baseUrl()}/reset?token=${token}`;
    // Respond instantly; deliver the email in the background.
    after(() => sendEmail(resetEmail(seller.email, link)));
  }
  // Same response regardless, to avoid user enumeration.
  return { sent: true };
}

/** Complete a password reset using a token from the email link. */
export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };

  const sellerId = await consumeToken(token, "reset");
  if (!sellerId)
    return { error: "This reset link is invalid or has expired. Request a new one." };

  await prisma.seller.update({
    where: { id: sellerId },
    data: { passwordHash: await hashPassword(password) },
  });

  redirect("/login?reset=1");
}
