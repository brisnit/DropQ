"use server";
import { signIn } from "@/auth";

/** Kick off Google OAuth, returning to `next` (or /my) afterwards. */
export async function googleSignInAction(formData: FormData): Promise<void> {
  const next = String(formData.get("next") ?? "") || "/my";
  await signIn("google", { redirectTo: next.startsWith("/") ? next : "/my" });
}
