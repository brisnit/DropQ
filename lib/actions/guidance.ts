"use server";

import { requireSeller } from "@/lib/auth";
import {
  COACHMARK_IDS,
  TIP_IDS,
  TOUR_LENGTH,
  guidanceApplicable,
  type CoachmarkId,
  type TipId,
} from "@/lib/guidance";
import {
  dismissCoachmark,
  dismissTip,
  endTour,
  markHelpOpened,
  markShared,
  markWelcomeSeen,
  setTourStep,
  startTour,
} from "@/lib/guidance-state";

/**
 * Server actions for vendor guidance.
 *
 * ⚠️ Server Actions are reachable by direct POST, not only through our own UI,
 * so every one of these authenticates first (`requireSeller`) and validates its
 * input against the typed registries in lib/guidance.ts. A forged POST can
 * therefore do exactly one thing: dismiss one of the vendor's own coachmarks.
 *
 * None of these `revalidatePath`. Guidance state is read during a normal render
 * and the client component already knows it dismissed something — forcing a
 * server round-trip and a re-render to make a bubble disappear would be slower
 * and would flash the page. The next natural navigation reads the new state.
 *
 * PHASE 1: every action here is complete and tested but CALLED BY NOTHING.
 * Phase 2 wires the tour and welcome; Phase 3 wires coachmarks and tips.
 */

/** Guidance never records anything for demo or internal accounts. */
async function guidanceSeller() {
  const seller = await requireSeller();
  return guidanceApplicable(seller) ? seller : null;
}

export async function markWelcomeSeenAction(): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  await markWelcomeSeen(seller.id);
}

export async function startTourAction(): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  await startTour(seller.id);
}

export async function setTourStepAction(step: number): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  // Clamped again in setTourStep; checked here so a nonsense value is rejected
  // rather than silently coerced to a valid-looking step.
  if (!Number.isInteger(step) || step < 0 || step >= TOUR_LENGTH) return;
  await setTourStep(seller.id, step);
}

export async function endTourAction(
  outcome: "completed" | "skipped",
  step: number
): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  if (outcome !== "completed" && outcome !== "skipped") return;
  await endTour(seller.id, outcome, Number.isInteger(step) ? step : 0);
}

/** Restarting from Help is just starting again — same state, same events. */
export async function restartTourAction(): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  await startTour(seller.id);
}

export async function dismissCoachmarkAction(id: string): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  if (!(COACHMARK_IDS as readonly string[]).includes(id)) return;
  await dismissCoachmark(seller.id, id as CoachmarkId);
}

export async function dismissTipAction(id: string): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  if (!(TIP_IDS as readonly string[]).includes(id)) return;
  await dismissTip(seller.id, id as TipId);
}

/**
 * Called when a vendor copies a drop link, uses the share sheet, or downloads
 * a QR. Fire-and-forget from the client — the share itself must never wait on
 * or fail because of this.
 */
export async function markSharedAction(): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  await markShared(seller.id);
}

export async function markHelpOpenedAction(): Promise<void> {
  const seller = await guidanceSeller();
  if (!seller) return;
  await markHelpOpened(seller.id);
}
