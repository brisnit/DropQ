import { SOCIALS, type SocialKey } from "@/lib/social";

function Icon({ name }: { name: SocialKey }) {
  const p = { viewBox: "0 0 24 24", className: "w-[18px] h-[18px]" } as const;
  switch (name) {
    case "instagram":
      return (
        <svg {...p} fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="2" width="20" height="20" rx="5.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...p} fill="currentColor">
          <path d="M16 3c.3 2 1.6 3.6 3.6 3.9v2.6c-1.3 0-2.6-.4-3.6-1.1v6.1c0 3.3-2.7 6-6 6s-6-2.7-6-6 2.7-6 6-6c.3 0 .7 0 1 .1v2.7c-.3-.1-.7-.2-1-.2-1.8 0-3.3 1.5-3.3 3.3S8.2 20.5 10 20.5s3.3-1.5 3.3-3.3V3H16z" />
        </svg>
      );
    case "twitter":
      return (
        <svg {...p} fill="currentColor">
          <path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L5.6 22H2.5l7.5-8.6L2 2h6.6l4.5 6.7L18.9 2zm-1.1 18.3h1.7L7.2 3.7H5.4l12.4 16.6z" />
        </svg>
      );
    case "facebook":
      return (
        <svg {...p} fill="currentColor">
          <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.2c-1.2 0-1.6.8-1.6 1.5V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12z" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...p} fill="currentColor">
          <path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 4.9 12 4.9 12 4.9s-7 0-8.9.5A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.5zM9.8 15.3V8.7l5.7 3.3-5.7 3.3z" />
        </svg>
      );
    case "website":
      return (
        <svg {...p} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18" />
        </svg>
      );
  }
}

type Socials = Partial<Record<SocialKey, string | null>>;

export function SocialLinks({ seller, accent }: { seller: Socials; accent?: string }) {
  const links = SOCIALS.map((s) => ({ ...s, url: seller[s.key] })).filter((l) => l.url);
  if (!links.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      {links.map((l) => (
        <a
          key={l.key}
          href={l.url!}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.label}
          title={l.label}
          className="w-9 h-9 rounded-full border border-line grid place-items-center hover:bg-cream transition"
          style={{ color: accent }}
        >
          <Icon name={l.key} />
        </a>
      ))}
    </div>
  );
}
