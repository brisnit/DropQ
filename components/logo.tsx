import Image from "next/image";
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
      <rect width="32" height="32" rx="9" fill="#cd1718" />
      {/* droplet */}
      <path
        d="M16 6c0 0 6.2 6.6 6.2 11.2A6.2 6.2 0 0 1 16 23.4a6.2 6.2 0 0 1-6.2-6.2C9.8 12.6 16 6 16 6z"
        fill="#ffffff"
      />
      {/* the 'Q' tail — a queue tick */}
      <path
        d="M18.6 19.6l3 3"
        stroke="#cd1718"
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
    <Link href={href} className="inline-flex items-center" aria-label="DropQ">
      <Image
        src="/brand/dropq-logo.png"
        alt="DropQ"
        width={1352}
        height={378}
        priority
        // Artwork is dark olive + red, so on dark surfaces render it as a
        // clean white silhouette instead of an invisible olive.
        className={`h-7 sm:h-8 w-auto ${light ? "brightness-0 invert" : ""}`}
      />
    </Link>
  );
}
