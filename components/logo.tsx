import Link from "next/link";

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="9" fill="#6d28d9" />
      {/* droplet */}
      <path
        d="M16 6c0 0 6.2 6.6 6.2 11.2A6.2 6.2 0 0 1 16 23.4a6.2 6.2 0 0 1-6.2-6.2C9.8 12.6 16 6 16 6z"
        fill="#ffffff"
      />
      {/* the 'Q' tail — a queue tick */}
      <path
        d="M18.6 19.6l3 3"
        stroke="#6d28d9"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({
  href = "/",
  light = false,
}: {
  href?: string;
  light?: boolean;
}) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 group">
      <Mark />
      <span
        className={`font-display text-[1.35rem] font-semibold tracking-tight ${
          light ? "text-cream" : "text-ink"
        }`}
      >
        Drop<span className="text-brand">Q</span>
      </span>
    </Link>
  );
}
