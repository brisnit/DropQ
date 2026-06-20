/** Read-only star display. `value` 0–5 (rounded to nearest star). */
export function Stars({
  value,
  className = "text-base",
}: {
  value: number;
  className?: string;
}) {
  const filled = Math.round(value);
  return (
    <span
      className={`inline-flex leading-none ${className}`}
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= filled ? "text-quad" : "text-line-strong"}>
          ★
        </span>
      ))}
    </span>
  );
}
