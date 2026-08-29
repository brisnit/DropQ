"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  TOUR_LENGTH,
  TOUR_STEPS,
  guidanceFor,
  guidanceTier,
  safeTourStep,
  START_TOUR_EVENT,
  type GuidanceState,
} from "@/lib/guidance";
import { trackGuidance } from "@/lib/analytics";
import {
  dismissCoachmarkAction,
  dismissTipAction,
  endTourAction,
  markWelcomeSeenAction,
  setTourStepAction,
  startTourAction,
} from "@/lib/actions/guidance";
import { GuidanceWelcome } from "@/components/guidance/welcome";
import { GuidanceTour } from "@/components/guidance/tour";
import { Coachmark } from "@/components/guidance/coachmark";
import { GuidanceTip } from "@/components/guidance/tip";
import type { GuidancePayload } from "@/lib/guidance-context";

/**
 * The single mount point for guidance, in the dashboard layout so it survives
 * navigation between dashboard pages.
 *
 * It renders AT MOST ONE thing, ever. `guidanceFor()` owns that precedence —
 * welcome > tour > coachmark > tip — and this component is the client half of
 * the same rule: it computes the decision with the current pathname and shows
 * whatever comes back.
 *
 * WHY THE DECISION IS MADE HERE. Coachmarks are route-specific and a layout has
 * no server-side pathname. `lib/guidance.ts` is pure and free of Prisma
 * precisely so it can run here against `usePathname()`, with the server having
 * shipped the facts once.
 *
 * Every write is fire-and-forget. Guidance must never make the dashboard feel
 * slow or fail: a dropped dismissal costs one repeated bubble, and that is a
 * far better outcome than a spinner in front of a vendor mid-task.
 *
 * ⚠️ Renders nothing when the server said guidance doesn't apply — demo store,
 * internal account. That decision is not re-derived here.
 */
export function GuidanceHost({
  payload,
  showWelcome,
  resumeTour,
  initialStep,
}: {
  payload: GuidancePayload;
  showWelcome: boolean;
  resumeTour: boolean;
  initialStep: number;
}) {
  const pathname = usePathname();
  const [mode, setMode] = useState<"welcome" | "tour" | null>(() =>
    !payload.applicable ? null : showWelcome ? "welcome" : resumeTour ? "tour" : null
  );
  const [step, setStep] = useState(() => safeTourStep(initialStep));
  const stamped = useRef(false);

  /**
   * Dismissals made in this browser, merged over what the server sent.
   *
   * The server payload only refreshes on navigation, so without this a
   * dismissed coachmark would reappear the moment anything re-rendered. Merged
   * rather than replaced so a dismissal recorded on a previous page load still
   * counts.
   */
  const [dismissed, setDismissed] = useState<{ marks: string[]; tips: string[] }>({
    marks: [],
    tips: [],
  });

  /**
   * Restarting the tour from the sidebar / menu.
   *
   * An explicit event rather than reacting to a prop: props come from the
   * server layout and `useState` initialisers run once, so `router.refresh()`
   * updates the prop but never the state. Syncing to the prop instead would
   * introduce a worse race — any unrelated refresh landing before
   * `endTourAction` commits would re-open a tour the vendor had just skipped.
   */
  useEffect(() => {
    const onStart = () => {
      setStep(0);
      setMode("tour");
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, []);

  // Stamp on DISPLAY, not dismissal. A vendor who closes the tab mid-modal has
  // still seen it; showing it again would be the "don't repeat yourself"
  // failure. The ref guards against React's double-invoked effects in dev.
  useEffect(() => {
    if (mode !== "welcome" || stamped.current) return;
    stamped.current = true;
    trackGuidance("onboarding_welcome_shown", {});
    void markWelcomeSeenAction().catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== "tour") return;
    const s = TOUR_STEPS[safeTourStep(step)];
    trackGuidance("onboarding_tour_step_viewed", { step, key: s.key });
  }, [mode, step]);

  /** State as the decision function should see it right now. */
  const liveState: GuidanceState = useMemo(
    () => ({
      ...payload.state,
      tourStatus: mode === "tour" ? "in_progress" : payload.state.tourStatus,
      dismissedCoachmarks: [...payload.state.dismissedCoachmarks, ...dismissed.marks],
      dismissedTips: [...payload.state.dismissedTips, ...dismissed.tips],
    }),
    [payload.state, dismissed, mode]
  );

  const decision = useMemo(
    () =>
      guidanceFor(
        { email: "", slug: "", internalKind: null },
        {
          pathname,
          tier: guidanceTier(payload.facts),
          state: liveState,
          facts: payload.facts,
          activation: payload.activation,
          capabilities: payload.capabilities,
          activationCardVisible: payload.activationCardVisible,
        },
        // Applicability was already decided server-side; forcing here avoids
        // shipping the vendor's email and slug to the client just to re-derive
        // an answer we already have.
        payload.applicable
      ),
    [pathname, payload, liveState]
  );

  const dismissCoachmark = useCallback((id: string) => {
    trackGuidance("coachmark_dismissed", { id });
    setDismissed((d) => ({ ...d, marks: [...d.marks, id] }));
    void dismissCoachmarkAction(id).catch(() => {});
  }, []);

  const dismissTip = useCallback((id: string) => {
    trackGuidance("smart_tip_dismissed", { id });
    setDismissed((d) => ({ ...d, tips: [...d.tips, id] }));
    void dismissTipAction(id).catch(() => {});
  }, []);

  // Report a coachmark / tip once per appearance, not once per render.
  const seen = useRef<Set<string>>(new Set());
  const markId = decision.coachmark?.id;
  const tipId = decision.tip?.id;
  useEffect(() => {
    if (markId && !seen.current.has(`c:${markId}`)) {
      seen.current.add(`c:${markId}`);
      trackGuidance("coachmark_shown", { id: markId });
    }
    if (tipId && !seen.current.has(`t:${tipId}`)) {
      seen.current.add(`t:${tipId}`);
      trackGuidance("smart_tip_shown", { id: tipId });
    }
  }, [markId, tipId]);

  if (!payload.applicable) return null;

  if (mode === "welcome") {
    return (
      <GuidanceWelcome
        storeName={payload.storeName}
        onStartTour={() => {
          trackGuidance("onboarding_welcome_dismissed", { action: "tour" });
          trackGuidance("onboarding_tour_started", { from: "welcome" });
          setStep(0);
          setMode("tour");
          void startTourAction().catch(() => {});
        }}
        onSkip={(via) => {
          trackGuidance("onboarding_welcome_dismissed", { action: via });
          // Deliberately does NOT mark the tour skipped — they skipped the
          // welcome, not the tour, and Help must still offer it as something
          // new. See tourInviteLabel().
          setMode(null);
        }}
      />
    );
  }

  if (mode === "tour") {
    return (
      <GuidanceTour
        step={step}
        onStep={(nextStep) => {
          const s = safeTourStep(nextStep);
          setStep(s);
          void setTourStepAction(s).catch(() => {});
        }}
        onFinish={(outcome) => {
          trackGuidance(
            outcome === "completed" ? "onboarding_tour_completed" : "onboarding_tour_skipped",
            outcome === "completed" ? { steps: TOUR_LENGTH } : { step }
          );
          setMode(null);
          void endTourAction(outcome, step).catch(() => {});
        }}
      />
    );
  }

  if (decision.coachmark) {
    const c = decision.coachmark;
    return (
      <Coachmark
        key={c.id}
        anchor={c.anchor}
        title={c.title}
        body={c.body}
        onDismiss={() => dismissCoachmark(c.id)}
      />
    );
  }

  if (decision.tip) {
    const t = decision.tip;
    return (
      <GuidanceTip
        key={t.id}
        tip={t}
        onDismiss={() => dismissTip(t.id)}
        onAct={() => {
          trackGuidance("smart_tip_clicked", { id: t.id });
          // Acting on a tip retires it: the vendor did the thing. Without this
          // it would still be waiting when they navigate back.
          setDismissed((d) => ({ ...d, tips: [...d.tips, t.id] }));
          void dismissTipAction(t.id).catch(() => {});
        }}
      />
    );
  }

  return null;
}
