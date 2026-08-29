import Link from "next/link";
import {
  activationCardMode,
  type ActivationState,
  type Milestone,
} from "@/lib/activation";

/**
 * "Get ready to sell" — the vendor's activation module on the dashboard.
 *
 * Deliberately dumb. Every decision (which milestones, which is next, how
 * prominent, whether to render at all) comes from `activationState()` in
 * lib/activation.ts. Nothing about readiness is decided here, so V.3's nudges
 * and V.Admin's view can't drift from what the vendor sees.
 *
 * It **supersedes** the dashboard's generic "Next step" card rather than
 * stacking beside it — see `showsGenericNextStep`. A vendor without Stripe used
 * to see "Connect Stripe to start selling" directly above "Your drop is ready
 * to publish", which is the contradiction this module exists to remove.
 *
 * Guidance only. Phase A's server-side gates in `placeOrderAction` and
 * `resolveDropStatus` remain the actual enforcement — nothing here can let a
 * vendor sell, and hiding it can't stop one.
 */

function Tick({ done }: { done: boolean }) {
  return done ? (
    <span
      aria-hidden
      className="w-5 h-5 shrink-0 rounded-full bg-sage text-white grid place-items-center text-[11px] font-bold"
    >
      ✓
    </span>
  ) : (
    <span
      aria-hidden
      className="w-5 h-5 shrink-0 rounded-full border-2 border-line-strong"
    />
  );
}

function MilestoneRow({ m, isNext }: { m: Milestone; isNext: boolean }) {
  const trailing = !m.done && (m.requiredToSell || (m.href && m.action));
  return (
    /* `flex-wrap` matters. This row can carry a label, a "Required to sell"
       pill AND an action link at once — only the Stripe milestone does — and on
       a 320px phone those do not fit on one line. Without wrapping, the action
       link ran off the right edge of the card and was unreachable.
       `overflow-x: clip` on <body> meant the page never gained a scrollbar, so
       the clipping was silent. */
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 py-1.5">
      <Tick done={m.done} />
      <span
        className={`min-w-[7rem] flex-1 ${
          m.done
            ? "text-muted line-through decoration-line-strong"
            : isNext
              ? "text-ink font-semibold"
              : "text-ink-soft"
        }`}
      >
        {m.label}
      </span>
      {/* Pill and action travel together as one unit, so they wrap onto a
          second line as a pair instead of the link being orphaned or clipped. */}
      {trailing && (
        <span className="flex items-center gap-2 ml-auto shrink-0">
          {m.requiredToSell && (
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-brand-dark bg-brand-tint rounded-pill px-2 py-0.5">
              Required to sell
            </span>
          )}
          {m.href && m.action && (
            <Link
              href={m.href}
              className="shrink-0 whitespace-nowrap text-sm font-semibold text-brand hover:text-brand-dark hover:underline underline-offset-4 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {m.action} <span aria-hidden>&rarr;</span>
              <span className="sr-only">: {m.label}</span>
            </Link>
          )}
        </span>
      )}
    </li>
  );
}

export function VendorActivationCard({ state }: { state: ActivationState }) {
  const mode = activationCardMode(state);
  if (mode === "hidden") return null;

  const next = state.nextAction;

  /* --------------------- Selling paused (was activated) ------------------ */
  // Not an onboarding checklist: this vendor already finished onboarding. One
  // message, one action.
  if (mode === "paused") {
    return (
      <div
        data-guidance-anchor="dash.checklist"
        className="mb-6 rounded-card bg-brand-tint border border-brand/40 p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-ink">
              ⏸️ Selling is paused
            </p>
            <p className="text-sm text-ink-soft mt-1 max-w-xl">
              {next?.reason ??
                "Stripe can't take card payments for your account right now, so your storefront isn't accepting orders."}
            </p>
            <p className="text-sm text-ink-soft mt-1.5">
              Your drops, products, orders and customers are safe. You can still edit
              drafts and close a live drop.
            </p>
          </div>
          {next && (
            <Link
              href={next.href}
              className="shrink-0 bg-ink text-cream font-semibold px-5 py-3 rounded-xl hover:bg-ink-soft transition"
            >
              {next.cta} →
            </Link>
          )}
        </div>
      </div>
    );
  }

  /* ------------------------ Ready to sell, no order ---------------------- */
  // Substantially reduced: they can take money, so the checklist has done its
  // job and shouldn't keep occupying the top of the dashboard.
  if (mode === "compact") {
    // First publish. `compact` already means "can sell, hasn't sold", so a
    // published drop with nothing shared yet is exactly the moment between
    // going live and telling anyone — the one worth marking.
    //
    // Derived, not stored: there is no "have we celebrated yet" flag, and it
    // needs none. The state ends the moment they share or take an order, and
    // re-entering it would mean they genuinely published something new.
    const published = state.milestones.find((m) => m.key === "publish")?.done;
    const shared = state.milestones.find((m) => m.key === "share")?.done;
    if (published && !shared) {
      return (
        <div
          data-guidance-anchor="dash.checklist"
          className="mb-6 rounded-card bg-sage-tint/60 border border-sage/40 p-5 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-ink">
              Your first drop is live 🎉
            </p>
            <p className="text-sm text-ink-soft mt-1 max-w-xl">
              Now get the link in front of people — that&rsquo;s the only thing between
              you and your first order.
            </p>
          </div>
          <Link
            href={next?.href ?? "/dashboard/drops"}
            className="shrink-0 inline-flex items-center justify-center min-h-11 bg-ink text-cream font-semibold px-5 py-3 rounded-xl hover:bg-ink-soft transition"
          >
            {next?.cta ?? "Share your drop"} →
          </Link>
        </div>
      );
    }

    return (
      <div
        data-guidance-anchor="dash.checklist"
        className="mb-6 rounded-card bg-sage-tint/60 border border-sage/30 px-4 py-3 sm:px-5 flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-ink flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="w-5 h-5 shrink-0 rounded-full bg-sage text-white grid place-items-center text-[11px] font-bold"
          >
            ✓
          </span>
          <span className="font-semibold">Ready to sell</span>
          {next && <span className="text-ink-soft">· {next.reason}</span>}
        </p>
        {next && (
          <Link
            href={next.href}
            className="shrink-0 text-sm font-semibold rounded-xl px-4 py-2 bg-ink text-cream hover:bg-ink-soft transition"
          >
            {next.cta} →
          </Link>
        )}
      </div>
    );
  }

  /* ---------------------------- Full checklist --------------------------- */
  const pct = Math.round((state.completed / state.total) * 100);

  return (
    <div
      data-guidance-anchor="dash.checklist"
      className="mb-6 rounded-card bg-paper border border-line-strong p-5 sm:p-6 shadow-[var(--shadow-soft)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Get ready to sell</h2>
        <p className="text-sm text-muted tabular-nums">
          {state.completed} of {state.total} complete
        </p>
      </div>

      <div
        className="mt-3 h-1.5 w-full rounded-pill bg-line overflow-hidden"
        role="progressbar"
        aria-valuenow={state.completed}
        aria-valuemin={0}
        aria-valuemax={state.total}
        aria-label="Activation progress"
      >
        <div className="h-full bg-sage rounded-pill transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="mt-4 text-sm">
        {state.milestones.map((m) => (
          <MilestoneRow key={m.key} m={m} isNext={next?.key === m.key} />
        ))}
      </ul>

      {next && (
        <div className="mt-4 pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-soft max-w-md">{next.reason}</p>
          <Link
            href={next.href}
            className="shrink-0 bg-ink text-cream font-semibold px-5 py-3 rounded-xl hover:bg-ink-soft transition"
          >
            {next.cta} →
          </Link>
        </div>
      )}
    </div>
  );
}
