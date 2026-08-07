import { initials } from "@/lib/messaging-shared";

// Deterministic tint per person, drawn from the DropQ palette so avatars feel
// native rather than randomly colored.
const TINTS = [
  "bg-brand-tint text-brand-dark",
  "bg-tertiary-tint text-[#00797b]",
  "bg-quad-tint text-[#8a6a00]",
  "bg-grey-tint text-grey-dark",
  "bg-sage-tint text-[#00797b]",
] as const;

function tintFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

const SIZES = {
  sm: "w-8 h-8 text-[11px]",
  md: "w-10 h-10 text-xs",
  lg: "w-12 h-12 text-sm",
} as const;

/**
 * Identity chip for a customer or vendor. Uses a real image when one exists
 * (vendor logos), otherwise clean initials — never an id or order number.
 */
export function Avatar({
  name,
  imageUrl,
  size = "md",
  seed,
}: {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZES;
  seed?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt={name}
        className={`${SIZES[size]} rounded-full object-cover border border-line shrink-0`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${SIZES[size]} ${tintFor(seed ?? name)} rounded-full shrink-0 inline-flex items-center justify-center font-semibold tracking-wide`}
    >
      {initials(name)}
    </span>
  );
}
