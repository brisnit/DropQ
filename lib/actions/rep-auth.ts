"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createRepSession, destroyRepSession } from "@/lib/rep-auth";

export type RepAuthState = { error?: string };

export async function repLoginAction(
  _prev: RepAuthState,
  formData: FormData
): Promise<RepAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const rep = await prisma.salesRep.findUnique({ where: { email } });
  // Uniform error — never reveal whether the account exists or is disabled.
  if (!rep || !rep.passwordHash || rep.status !== "active" || !(await verifyPassword(password, rep.passwordHash))) {
    return { error: "Wrong email or password, or your account isn't active yet." };
  }
  await createRepSession(rep.id);
  redirect("/rep");
}

export async function repLogoutAction(): Promise<void> {
  await destroyRepSession();
  redirect("/rep/login");
}
