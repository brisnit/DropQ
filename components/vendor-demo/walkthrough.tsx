"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui";
import {
  DEMO_BUSINESS,
  DEMO_DROP,
  DEMO_MARKER,
  DEMO_ORDERS,
  DEMO_RESULTS,
  DEMO_STEPS,
  DEMO_STEP_COUNT,
  type DemoStepKey,
} from "@/lib/vendor-demo";

/**
 * The interactive part of /vendor-demo.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────────
 *
 * It is not connected to anything. No server action, no fetch, no Stripe, no
 * database. Every piece of state below is a `useState` that dies with the tab.
 * A stranger at a market can tap every control on this page and the platform
 * will not know they existed.
 *
 * ── WHY IT IS A REPLICA AND NOT THE REAL COMPONENTS ───────────────────────
 *
 * The real vendor tour (components/guidance/tour.tsx) anchors its bubble to
 * live dashboard elements by measuring them. Reusing it here would have meant
 * building a fake dashboard for it to point at, and any drift in the real
 * dashboard would silently break a page we hand to prospects. So this mirrors
 * the real flow's STRUCTURE and COPY — the six steps in lib/guidance.ts, in the
 * product's own voice — while owning its markup.
 *
 * The one thing it must never do is flatter. A vendor who signs up because of
 * this page and finds something different has been mis-sold, which is worse
 * than not signing up at all.
 */
export function VendorDemoWalkthrough() {
  const [index, setIndex] = useState(0);
  const [stripe, setStripe] = useState<"idle" | "connecting" | "done">("idle");
  const [ordered, setOrdered] = useState(false);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const started = useRef(false);

  const step = DEMO_STEPS[index];
  const isLast = index === DEMO_STEP_COUNT - 1;

  /**
   * Move focus to the panel heading on each step.
   *
   * Without this a screen-reader user taps "Next" and hears nothing change —
   * the button keeps focus while the whole screen behind it swaps. Skipped on
   * first render so the page does not yank focus mid-scroll before anyone has
   * chosen to start.
   */
  useEffect(() => {
    if (!started.current) { started.current = true; return; }
    panelRef.current?.querySelector<HTMLElement>("[data-demo-heading]")?.focus();
  }, [index]);

  function advance() {
    if (step.key === "stripe" && stripe !== "done") {
      setStripe("connecting");
      // The real handoff is a redirect to Stripe and back, which takes a few
      // seconds. Showing it instantly would be a lie in the vendor's favour;
      // showing a spinner sets the right expectation in under a second.
      window.setTimeout(() => setStripe("done"), 900);
      return;
    }
    if (step.key === "storefront" && !ordered) {
      setOrdered(true);
      return;
    }
    if (isLast) { restart(); return; }
    setIndex((i) => Math.min(i + 1, DEMO_STEP_COUNT - 1));
  }

  function restart() {
    setIndex(0);
    setStripe("idle");
    setOrdered(false);
  }

  // The CTA label follows the state, not just the step, so the button never
  // says "Connect Stripe" about a connection that already happened.
  const cta =
    step.key === "stripe" && stripe === "connecting" ? "Connecting…"
      : step.key === "stripe" && stripe === "done" ? "Next"
      : step.key === "storefront" && ordered ? "See the confirmation"
      : isLast ? "Show me again"
      : step.cta;

  return (
    <div data-demo={DEMO_MARKER} className="mt-8">
      {/* Whose screen this is. Stated in words above the phone, because the
          switch from vendor to customer is the moment the page either lands or
          confuses, and a colour change alone does not say it. */}
      <div className="flex items-center justify-center gap-2 mb-3">
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] px-3 py-1.5 rounded-pill transition ${
            step.side === "customer"
              ? "bg-brand-tint text-brand-dark"
              : "bg-tertiary-tint text-[#046b6d]"
          }`}
        >
          {step.perspective}
        </span>
      </div>

      <div className="mx-auto w-full max-w-[380px]">
        {/* The phone. On a phone this is just a card; on a desktop the frame is
            what stops the demo stretching into something no vendor will ever
            see. */}
        <div className="rounded-[2rem] border border-line bg-paper shadow-[var(--shadow-lift)] overflow-hidden">
          <div className="h-9 bg-cream border-b border-line flex items-center justify-center">
            <span className="text-[0.7rem] text-muted tabular-nums">
              {step.side === "customer" ? DEMO_BUSINESS.storefront : "DropQ"}
            </span>
          </div>

          <div ref={panelRef} className="p-5 min-h-[23rem] flex flex-col">
            <Screen stepKey={step.key} stripe={stripe} ordered={ordered} headingId={headingId} />
          </div>
        </div>

        {/* Controls sit below the phone and span its full width: at a market
            this is operated with one thumb, often by someone who has never seen
            the page before. */}
        <div className="mt-4">
          <Button
            type="button"
            size="lg"
            onClick={advance}
            disabled={stripe === "connecting"}
            className="w-full disabled:opacity-70"
          >
            {cta}
          </Button>

          <div className="mt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setIndex((i) => Math.max(i - 1, 0))}
              disabled={index === 0}
              className="min-h-11 px-3 -ml-3 text-sm font-medium text-muted hover:text-ink disabled:opacity-0 transition rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary/60"
            >
              ← Back
            </button>

            {/* Dots, not "3 of 7": at a glance it should read as "nearly
                done", and a number invites reading rather than tapping. */}
            <ol className="flex items-center gap-1.5" aria-label={`Step ${index + 1} of ${DEMO_STEP_COUNT}`}>
              {DEMO_STEPS.map((s, i) => (
                <li
                  key={s.key}
                  aria-current={i === index ? "step" : undefined}
                  className={`h-1.5 rounded-pill transition-all ${
                    i === index ? "w-5 bg-ink" : i < index ? "w-1.5 bg-ink/35" : "w-1.5 bg-line-strong"
                  }`}
                />
              ))}
            </ol>

            <span className="min-h-11 flex items-center text-sm text-muted tabular-nums" aria-hidden>
              {index + 1}/{DEMO_STEP_COUNT}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero's still: the customer's view, in the same phone as the demo.
 *
 * It replaced a Help-article screenshot that carried its tutorial annotation —
 * a numbered badge and a red highlight ring — which on a marketing page read as
 * "step 2 of a manual" rather than "this is the product". Every shot in
 * public/help is annotated that way, by design, so none of them belong here.
 *
 * Rendering the real component instead means the hero cannot drift from the
 * demo below it, and there is no screenshot to regenerate when the UI moves.
 */
export function VendorDemoStorefrontPreview() {
  return (
    <div className="rounded-[2rem] border border-line bg-paper shadow-[var(--shadow-lift)] overflow-hidden">
      <div className="h-9 bg-cream border-b border-line flex items-center justify-center">
        <span className="text-[0.7rem] text-muted">{DEMO_BUSINESS.storefront}</span>
      </div>
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          What your customers see
        </p>
        <div className="mt-3">
          <StorefrontScreen ordered={false} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ screens ---- */

function Screen({
  stepKey, stripe, ordered, headingId,
}: {
  stepKey: DemoStepKey;
  stripe: "idle" | "connecting" | "done";
  ordered: boolean;
  headingId: string;
}) {
  const step = DEMO_STEPS.find((s) => s.key === stepKey)!;

  return (
    <>
      <h3
        id={headingId}
        data-demo-heading
        tabIndex={-1}
        className="font-display text-xl font-semibold tracking-tight focus:outline-none"
      >
        {step.title}
      </h3>
      <p className="text-sm text-ink-soft mt-1.5">{step.body}</p>

      <div className="mt-4 flex-1">
        {stepKey === "welcome" && <WelcomeScreen />}
        {stepKey === "business" && <BusinessScreen />}
        {stepKey === "stripe" && <StripeScreen state={stripe} />}
        {stepKey === "drop" && <DropScreen />}
        {stepKey === "storefront" && <StorefrontScreen ordered={ordered} />}
        {stepKey === "order" && <OrderScreen />}
        {stepKey === "dashboard" && <DashboardScreen />}
      </div>
    </>
  );
}

function WelcomeScreen() {
  return (
    <ul className="space-y-2.5">
      {["Set up your store", "Connect Stripe", "Build your first drop", "Watch the orders land"].map(
        (line, i) => (
          <li key={line} className="flex items-center gap-3 text-sm">
            <span className="shrink-0 w-7 h-7 grid place-items-center rounded-full bg-cream border border-line text-xs font-semibold tabular-nums">
              {i + 1}
            </span>
            <span className="text-ink-soft">{line}</span>
          </li>
        )
      )}
    </ul>
  );
}

/** Fields fill themselves in. The claim being made is "this is quick". */
function BusinessScreen() {
  const rows = [
    { label: "Store name", value: DEMO_BUSINESS.name },
    { label: "What you make", value: DEMO_BUSINESS.category },
    { label: "Where you are", value: DEMO_BUSINESS.location },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <Filled key={r.label} label={r.label} value={r.value} delay={i * 260} />
      ))}
      <p className="text-xs text-muted pt-1">
        Your store is live at {DEMO_BUSINESS.storefront}
      </p>
    </div>
  );
}

function DropScreen() {
  const rows = [
    { label: "Drop name", value: DEMO_DROP.title },
    { label: "Item", value: `${DEMO_DROP.productName} · ${DEMO_DROP.price}` },
    { label: "How many", value: `${DEMO_DROP.quantity} loaves` },
    { label: "Pickup", value: `${DEMO_DROP.pickupDay}, ${DEMO_DROP.pickupWindow}` },
    { label: "Where", value: DEMO_DROP.pickupPlace },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <Filled key={r.label} label={r.label} value={r.value} delay={i * 200} />
      ))}
    </div>
  );
}

/**
 * A field that types itself in.
 *
 * Respects prefers-reduced-motion by appearing immediately — the information is
 * the point, the animation only sells the speed.
 */
function Filled({ label, value, delay }: { label: string; value: string; delay: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setShown(true); return; }
    const t = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(t);
  }, [delay]);

  return (
    <div>
      <span className="block text-[0.7rem] font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <div
        className={`mt-1 rounded-xl border px-3 py-2.5 text-sm transition-all duration-300 ${
          shown
            ? "border-line-strong bg-paper text-ink translate-y-0 opacity-100"
            : "border-line bg-cream text-transparent translate-y-1 opacity-60"
        }`}
      >
        {shown ? value : " "}
      </div>
    </div>
  );
}

function StripeScreen({ state }: { state: "idle" | "connecting" | "done" }) {
  return (
    <div className="h-full flex flex-col justify-center text-center">
      <div
        className={`mx-auto w-14 h-14 rounded-2xl grid place-items-center text-2xl transition ${
          state === "done" ? "bg-tertiary-tint" : "bg-cream border border-line"
        }`}
        aria-hidden
      >
        {state === "done" ? "✓" : "🔒"}
      </div>
      <p className="font-semibold mt-3">
        {state === "done" ? "Stripe connected" : state === "connecting" ? "Connecting…" : "Payments go to you"}
      </p>
      <p className="text-sm text-muted mt-1.5 px-2">
        {state === "done"
          ? "Card payments now go straight to your Stripe account."
          : "DropQ never holds your money. Stripe pays you directly and takes its processing fee."}
      </p>
      {state === "connecting" && (
        <div className="mx-auto mt-4 h-1 w-32 rounded-pill bg-line overflow-hidden" aria-hidden>
          <div className="h-full w-1/2 bg-ink/60 rounded-pill animate-[demoslide_0.9s_ease-in-out]" />
        </div>
      )}
    </div>
  );
}

/** The customer's view: the product card a real storefront renders. */
function StorefrontScreen({ ordered }: { ordered: boolean }) {
  return (
    <div>
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
        {DEMO_BUSINESS.name}
      </p>
      <p className="font-display text-lg font-semibold mt-0.5">{DEMO_DROP.title}</p>

      <div className="mt-3 rounded-card border border-line bg-paper p-3 flex gap-3 items-center">
        <div className="shrink-0 w-14 h-14 rounded-xl bg-cream border border-line grid place-items-center text-2xl" aria-hidden>
          🍞
        </div>
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{DEMO_DROP.productName}</p>
          <p className="text-xs text-muted mt-0.5">{DEMO_DROP.productBlurb}</p>
          <p className="text-sm font-semibold mt-1">
            {DEMO_DROP.price}
            <span className="ml-2 text-xs font-normal text-muted">
              {ordered ? DEMO_RESULTS.remaining - 1 : DEMO_RESULTS.remaining} left
            </span>
          </p>
        </div>
      </div>

      <dl className="mt-3 text-xs space-y-1">
        <div className="flex gap-2">
          <dt className="text-muted w-14 shrink-0">Pickup</dt>
          <dd className="min-w-0">{DEMO_DROP.pickupDay}, {DEMO_DROP.pickupWindow}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted w-14 shrink-0">Where</dt>
          <dd className="min-w-0">{DEMO_DROP.pickupPlace}</dd>
        </div>
      </dl>
    </div>
  );
}

function OrderScreen() {
  return (
    <div className="h-full flex flex-col justify-center text-center">
      <div className="mx-auto w-14 h-14 rounded-full bg-tertiary-tint grid place-items-center text-2xl" aria-hidden>
        ✓
      </div>
      <p className="font-semibold mt-3">Order confirmed</p>
      <p className="text-sm text-muted mt-1.5 px-2">
        One {DEMO_DROP.productName}, {DEMO_DROP.price}. Collect {DEMO_DROP.pickupDay} at{" "}
        {DEMO_DROP.pickupPlace}.
      </p>
      <p className="text-xs text-muted mt-3">They get this. You get the order.</p>
    </div>
  );
}

function DashboardScreen() {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Sold", value: `${DEMO_RESULTS.sold}/${DEMO_DROP.quantity}` },
          { label: "Orders", value: String(DEMO_RESULTS.orders) },
          { label: "Taken", value: DEMO_RESULTS.revenue },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-cream px-2.5 py-2 min-w-0">
            <p className="text-[0.65rem] uppercase tracking-wide text-muted">{s.label}</p>
            <p className="font-display text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <ul className="mt-3 divide-y divide-line rounded-card border border-line overflow-hidden">
        {DEMO_ORDERS.map((o) => (
          <li key={o.name} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm bg-paper">
            <span className="min-w-0 truncate">
              <span className="font-medium">{o.name}</span>
              <span className="text-muted"> · {o.loaves} {o.loaves === 1 ? "loaf" : "loaves"}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-pill bg-tertiary-tint text-[#046b6d]">
              {o.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
