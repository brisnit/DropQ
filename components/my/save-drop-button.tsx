import { toggleSavedDropAction, isDropSaved } from "@/lib/actions/saved-drop";

/**
 * Save a drop for later. Drop it anywhere a drop is shown.
 *
 * Deliberately reads its own state rather than taking a `saved` prop, so a
 * caller can't render a stale star. Saving is a private bookmark — it tells the
 * vendor nothing and grants no marketing consent.
 */
export async function SaveDropButton({
  dropId,
  returnTo,
  variant = "pill",
}: {
  dropId: string;
  returnTo: string;
  variant?: "pill" | "icon";
}) {
  const saved = await isDropSaved(dropId);

  const className =
    variant === "icon"
      ? `w-11 h-11 rounded-full inline-flex items-center justify-center border transition ${
          saved ? "bg-ink text-cream border-ink" : "bg-paper/95 backdrop-blur border-line text-ink"
        }`
      : `inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-pill text-sm font-semibold transition active:scale-[0.98] ${
          saved
            ? "bg-ink text-cream"
            : "border border-line-strong bg-paper text-ink hover:border-ink/30"
        }`;

  return (
    <form action={toggleSavedDropAction}>
      <input type="hidden" name="dropId" value={dropId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        className={className}
        aria-label={saved ? "Remove from saved" : "Save this drop"}
      >
        <span aria-hidden>{saved ? "★" : "☆"}</span>
        {variant === "pill" && (saved ? "Saved" : "Save")}
      </button>
    </form>
  );
}
