/** Small Stripe-branded graphical cue (Stripe brand purple). */
export function StripeMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-label="Stripe"
      title="Stripe"
      className="inline-flex items-center justify-center rounded-md bg-[#635BFF] text-white font-bold leading-none shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
    >
      S
    </span>
  );
}
