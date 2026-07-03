import { redirect } from "next/navigation";

// Sales reps now log in with their normal DropQ account (same email the admin
// entered); the Referral Dashboard unlocks automatically.
export default function RepLoginRedirect() {
  redirect("/login");
}
