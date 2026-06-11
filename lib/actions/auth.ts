"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { slugify } from "@/lib/format";

export type AuthState = { error?: string };

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base) || "store";
  let candidate = root;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
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

  if (!storeName) return { error: "Give your store a name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { error: "Enter a valid email." };
  if (password.length < 8)
    return { error: "Password must be at least 8 characters." };

  const existing = await prisma.seller.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const seller = await prisma.seller.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      storeName,
      slug: await uniqueSlug(storeName),
    },
  });

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
