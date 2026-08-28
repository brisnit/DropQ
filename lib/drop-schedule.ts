// Single source of truth for the date relationships a drop's schedule must
// satisfy. Imported by BOTH the client editor (immediate, friendly errors) and
// the server actions (the real gate — the client can be bypassed).
//
// Why this exists: two production drops were created on 2026-06-17, before the
// editor had any ordering validation, when the form was a pair of bare optional
// <input type="datetime-local"> fields. `createDropAction` persisted whatever
// arrived. See scripts/drop-schedule-selftest.mjs.
//
// Rules are RELATIONAL only. Nothing here rewrites a date, and nothing here
// looks at the clock — a drop whose windows are entirely in the past is valid,
// so historical drops stay editable.

export type DropScheduleInput = {
  opensAt: Date | null;
  closesAt: Date | null;
  pickupStartAt: Date | null;
  pickupEndAt: Date | null;
};

export type ScheduleIssue = {
  /** The form field a vendor should fix. */
  field: "opensAt" | "closesAt" | "pickupStartAt" | "pickupEndAt";
  message: string;
};

function invalid(d: Date | null): boolean {
  return d !== null && Number.isNaN(d.getTime());
}

/**
 * Every rule the schedule breaks, in the order a vendor would fix them.
 * An empty array means the schedule is persistable.
 *
 * Deliberately NOT enforced here: "a preorder drop must have an order window".
 * Three closed production drops legitimately have neither date, and this
 * function also guards edits of historical records. The editor applies that
 * stricter requirement for new preorder drops on top of these rules.
 */
export function validateDropSchedule(input: DropScheduleInput): ScheduleIssue[] {
  const { opensAt, closesAt, pickupStartAt, pickupEndAt } = input;
  const issues: ScheduleIssue[] = [];

  // 0. Unparseable input (e.g. `new Date("banana")`) — fail loudly rather than
  //    letting Prisma throw something cryptic downstream.
  const named = [
    ["opensAt", opensAt, "open date/time"],
    ["closesAt", closesAt, "close date/time"],
    ["pickupStartAt", pickupStartAt, "pickup start"],
    ["pickupEndAt", pickupEndAt, "pickup end"],
  ] as const;
  for (const [field, value, label] of named) {
    if (invalid(value)) {
      issues.push({ field, message: `The ${label} isn't a valid date.` });
    }
  }
  if (issues.length) return issues;

  // 1. Each window is all-or-nothing. A half-open window can't be reasoned
  //    about by the storefront, the countdown, or computeDropPhase.
  if (opensAt && !closesAt) {
    issues.push({ field: "closesAt", message: "This drop has an open date/time but no close date/time. Set a close date/time." });
  }
  if (!opensAt && closesAt) {
    issues.push({ field: "opensAt", message: "This drop has a close date/time but no open date/time. Set an open date/time." });
  }
  if (pickupStartAt && !pickupEndAt) {
    issues.push({ field: "pickupEndAt", message: "This drop has a pickup start but no pickup end. Set a pickup end time." });
  }
  if (!pickupStartAt && pickupEndAt) {
    issues.push({ field: "pickupStartAt", message: "This drop has a pickup end but no pickup start. Set a pickup start time." });
  }

  // 2. Ordering closes strictly after it opens.
  if (opensAt && closesAt && closesAt <= opensAt) {
    issues.push({ field: "closesAt", message: "Close date/time must be after the open date/time." });
  }

  // 3. Pickup ends strictly after it starts.
  if (pickupStartAt && pickupEndAt && pickupEndAt <= pickupStartAt) {
    issues.push({ field: "pickupEndAt", message: "Pickup end must be after pickup start." });
  }

  // 4. Ordering closes before (or exactly at) pickup start.
  //
  //    This is product intent, not an invented constraint: the editor tells
  //    vendors "Must start on or after your order close time", the Pickup
  //    section reads "after ordering closes", and the schema comments the field
  //    as the window "after ordering closes". Every one of the 8 production
  //    drops with a pickup window already satisfies it. `>=` is deliberate —
  //    "on or after" means back-to-back windows are allowed.
  if (closesAt && pickupStartAt && pickupStartAt < closesAt) {
    issues.push({ field: "pickupStartAt", message: "Pickup can't start before ordering closes." });
  }

  return issues;
}

/** The first issue's message, or null when the schedule is valid. */
export function firstScheduleError(input: DropScheduleInput): string | null {
  return validateDropSchedule(input)[0]?.message ?? null;
}

/**
 * Server-side gate. Throws rather than returning, so a forged or scripted
 * request can never persist an invalid schedule — the actions are plain
 * `(formData) => void` server actions with no error channel of their own.
 */
export function assertValidDropSchedule(input: DropScheduleInput): void {
  const issues = validateDropSchedule(input);
  if (issues.length) {
    throw new Error(`Invalid drop schedule: ${issues.map((i) => i.message).join(" ")}`);
  }
}
