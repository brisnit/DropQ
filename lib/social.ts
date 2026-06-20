// Social media platforms a vendor can link from their storefront.

export type SocialKey =
  | "instagram"
  | "tiktok"
  | "twitter"
  | "facebook"
  | "youtube"
  | "website";

export const SOCIALS: {
  key: SocialKey;
  label: string;
  base: string; // prefix when the vendor enters just a handle
  placeholder: string;
}[] = [
  { key: "instagram", label: "Instagram", base: "https://instagram.com/", placeholder: "@yourhandle" },
  { key: "tiktok", label: "TikTok", base: "https://tiktok.com/@", placeholder: "@yourhandle" },
  { key: "twitter", label: "X (Twitter)", base: "https://x.com/", placeholder: "@yourhandle" },
  { key: "facebook", label: "Facebook", base: "https://facebook.com/", placeholder: "yourpage" },
  { key: "youtube", label: "YouTube", base: "https://youtube.com/@", placeholder: "@yourchannel" },
  { key: "website", label: "Website", base: "", placeholder: "https://yoursite.com" },
];

/** Turn a handle or partial URL into a full, safe https URL (or null if empty). */
export function normalizeSocialUrl(key: SocialKey, raw: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (key === "website") return `https://${v.replace(/^\/+/, "")}`;
  const handle = v.replace(/^@+/, "").replace(/^\/+/, "");
  const base = SOCIALS.find((s) => s.key === key)?.base ?? "";
  return base ? base + handle : null;
}
