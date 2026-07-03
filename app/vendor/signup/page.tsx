import { redirect } from "next/navigation";

// Sales-rep signup links use /vendor/signup?ref=CODE. This forwards to the real
// signup page, preserving the referral code (and any other params) so the code
// is captured and the vendor is attributed to the rep.
export default async function VendorSignupAlias({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  const q = qs.toString();
  redirect(`/signup${q ? `?${q}` : ""}`);
}
