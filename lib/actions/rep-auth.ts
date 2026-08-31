"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPasswordConstantTime } from "@/lib/auth";
import { createRepSession, destroyRepSession } from "@/lib/rep-auth";
import { consume, peek, requestIp } from "@/lib/rate-limit";

/** One message for every failure mode — unknown, inactive, wrong password, throttled. */
const WRONG_REP_CREDENTIALS = "Wrong email or password, or your account isn't active yet.";

export type RepAuthState = { error?: string };

export async function repLoginAction(
  _prev: RepAuthState,
  formData: FormData
): Promise<RepAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const ip = await requestIp();

  // Same shape as vendor login: checked before bcrypt, and a block returns the
  // ordinary error so it cannot be used to probe which reps exist.
  const gate = await peek("login", { email, ip });
  if (!gate.allowed) return { error: WRONG_REP_CREDENTIALS };

  const rep = await prisma.salesRep.findUnique({ where: { email } });
  // Constant-time: an unknown or inactive rep costs the same bcrypt comparison
  // as an active one, so timing is not an oracle either.
  const usable = rep && rep.passwordHash && rep.status === "active";
  const ok = await verifyPasswordConstantTime(password, usable ? rep.passwordHash : null);
  // Uniform error — never reveal whether the account exists or is disabled.
  if (!usable || !ok) {
    await consume("login", { email, ip });
    return { error: WRONG_REP_CREDENTIALS };
  }
  await createRepSession(rep.id);
  redirect("/rep");
}

export async function repLogoutAction(): Promise<void> {
  await destroyRepSession();
  redirect("/rep/login");
}
