import { redirect } from "next/navigation";

// The sales-rep dashboard now lives inside the main dashboard (activated by
// signing in with the rep's email). Keep this path working for old links.
export default function RepIndex() {
  redirect("/dashboard/referrals");
}
