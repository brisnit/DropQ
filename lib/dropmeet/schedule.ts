/**
 * Market recurrence → concrete dated occurrences.
 *
 * Schedules are stored structurally (day-of-week + local wall-clock times), not
 * as free text, so "what's open this weekend" is a real query rather than string
 * matching. Times are local wall-clock on purpose: a market that opens at 9am
 * opens at 9am in June and in December, so we resolve them against the market's
 * IANA timezone at expansion time instead of storing UTC instants.
 *
 * Client-safe (pure date math, no Prisma) so cards can re-render without a
 * round trip.
 */

export type ScheduleRule = {
  id: string;
  recurrence: string; // weekly | monthly | one_time | seasonal
  dayOfWeek: number | null;
  weekOfMonth: number | null;
  startDate: Date | string | null;
  endDate: Date | string | null;
  startTime: string | null; // "09:00" — null when the source gave a day but no hours
  endTime: string | null; // "14:00"
  timezone: string;
  active: boolean;
  notes?: string | null;
};

export type ScheduleException = {
  date: Date | string;
  type: string; // cancelled | closed | special_hours
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
};

export type Occurrence = {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  start: Date;
  end: Date;
  startTime: string | null;
  endTime: string | null;
  /** The day is known but the opening hours are not. */
  hoursUnknown: boolean;
  cancelled: boolean;
  note?: string | null;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseHm(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

/** YYYY-MM-DD for a Date as seen in `timezone`. */
export function localDateKey(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Day of week (0=Sun) for a Date as seen in `timezone`. */
export function localDayOfWeek(d: Date, timezone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(d);
  return DAY_SHORT.indexOf(name);
}

/**
 * The UTC instant of a local wall-clock time on a given local date.
 * Works by measuring the zone's offset at that moment and correcting for it,
 * which stays right across DST transitions.
 */
export function zonedTimeToUtc(dateKey: string, hm: string, timezone: string): Date {
  const { h, m } = parseHm(hm);
  const [y, mo, d] = dateKey.split("-").map((n) => parseInt(n, 10));
  // First guess: treat the wall clock as UTC.
  const guess = Date.UTC(y, mo - 1, d, h, m);
  // What wall-clock time does that instant show in the target zone?
  const shown = new Date(guess);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(shown);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  const shownUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  // The difference is the zone offset; subtract it to land on the right instant.
  return new Date(guess + (guess - shownUtc));
}

/** Which occurrence of its weekday a date is within its month (1-based). */
function weekOfMonthFor(dateKey: string): number {
  const day = parseInt(dateKey.split("-")[2], 10);
  return Math.floor((day - 1) / 7) + 1;
}

function isLastWeekdayOfMonth(dateKey: string): boolean {
  const [y, mo, d] = dateKey.split("-").map((n) => parseInt(n, 10));
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d + 7 > daysInMonth;
}

function ruleAppliesOn(rule: ScheduleRule, dateKey: string, dow: number): boolean {
  if (!rule.active) return false;

  const within = (() => {
    if (rule.startDate) {
      const s = typeof rule.startDate === "string" ? rule.startDate.slice(0, 10) : localDateKey(rule.startDate, rule.timezone);
      if (dateKey < s) return false;
    }
    if (rule.endDate) {
      const e = typeof rule.endDate === "string" ? rule.endDate.slice(0, 10) : localDateKey(rule.endDate, rule.timezone);
      if (dateKey > e) return false;
    }
    return true;
  })();
  if (!within) return false;

  switch (rule.recurrence) {
    case "one_time": {
      if (!rule.startDate) return false;
      const s =
        typeof rule.startDate === "string"
          ? rule.startDate.slice(0, 10)
          : localDateKey(rule.startDate, rule.timezone);
      return dateKey === s;
    }
    case "weekly":
    case "seasonal":
      return rule.dayOfWeek === dow;
    case "monthly": {
      if (rule.dayOfWeek !== dow) return false;
      if (rule.weekOfMonth == null) return true;
      if (rule.weekOfMonth === -1) return isLastWeekdayOfMonth(dateKey);
      return weekOfMonthFor(dateKey) === rule.weekOfMonth;
    }
    default:
      return false;
  }
}

/**
 * Expand rules into dated occurrences across a window, applying exceptions.
 * Cancelled dates are returned (flagged) rather than dropped, so a market page
 * can say "no market this Sunday — holiday" instead of silently going quiet.
 */
export function expandOccurrences(
  rules: ScheduleRule[],
  exceptions: ScheduleException[],
  opts: { from: Date; days: number; timezone?: string; includeCancelled?: boolean }
): Occurrence[] {
  const tz = opts.timezone ?? rules[0]?.timezone ?? "America/Los_Angeles";
  const exceptionByDate = new Map<string, ScheduleException>();
  for (const ex of exceptions) {
    const key = typeof ex.date === "string" ? ex.date.slice(0, 10) : localDateKey(ex.date, tz);
    exceptionByDate.set(key, ex);
  }

  const out: Occurrence[] = [];
  for (let i = 0; i < opts.days; i++) {
    const cursor = new Date(opts.from.getTime() + i * 86_400_000);
    const dateKey = localDateKey(cursor, tz);
    const dow = localDayOfWeek(cursor, tz);

    for (const rule of rules) {
      if (!ruleAppliesOn(rule, dateKey, dow)) continue;

      const ex = exceptionByDate.get(dateKey);
      const cancelled = !!ex && (ex.type === "cancelled" || ex.type === "closed");
      const rawStart = ex?.type === "special_hours" && ex.startTime ? ex.startTime : rule.startTime;
      const rawEnd = ex?.type === "special_hours" && ex.endTime ? ex.endTime : rule.endTime;
      const hoursUnknown = !rawStart || !rawEnd;

      // With no hours on file the occurrence still exists — it spans the whole
      // local day so date filters behave — but it reports hoursUnknown so the
      // UI says "hours not listed" instead of inventing a window.
      const start = zonedTimeToUtc(dateKey, rawStart ?? "00:00", rule.timezone);
      const end = zonedTimeToUtc(dateKey, rawEnd ?? "23:59", rule.timezone);

      out.push({
        date: dateKey,
        start,
        end,
        startTime: rawStart,
        endTime: rawEnd,
        hoursUnknown,
        cancelled,
        note: ex?.note ?? null,
      });
      if (cancelled && !opts.includeCancelled) continue;
      break; // one occurrence per day, even if several rules match
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** "9:00 AM" from "09:00". */
export function formatTime(hm: string): string {
  const { h, m } = parseHm(hm);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** "Sundays · 9 AM–2 PM" — the human line on a market card. */
export function describeRule(rule: ScheduleRule): string {
  const time =
    rule.startTime && rule.endTime
      ? `${formatTime(rule.startTime)}–${formatTime(rule.endTime)}`
      : "hours not listed";
  if (rule.recurrence === "one_time" && rule.startDate) {
    const d = typeof rule.startDate === "string" ? new Date(rule.startDate) : rule.startDate;
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${time}`;
  }
  if (rule.dayOfWeek == null) return time;
  const day = DAY_NAMES[rule.dayOfWeek];
  if (rule.recurrence === "monthly") {
    const which =
      rule.weekOfMonth === -1
        ? "Last"
        : rule.weekOfMonth === 1
          ? "First"
          : rule.weekOfMonth === 2
            ? "Second"
            : rule.weekOfMonth === 3
              ? "Third"
              : rule.weekOfMonth === 4
                ? "Fourth"
                : "Every";
    return `${which} ${day} · ${time}`;
  }
  if (rule.recurrence === "seasonal") return `${day}s (seasonal) · ${time}`;
  return `${day}s · ${time}`;
}

export function dayLabel(dateKey: string, timezone = "America/Los_Angeles"): string {
  const d = zonedTimeToUtc(dateKey, "12:00", timezone);
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: timezone }).toUpperCase();
}

// ── Date-window helpers powering the Today / This Weekend filters ───────────

export function todayWindow(now: Date, timezone = "America/Los_Angeles") {
  const key = localDateKey(now, timezone);
  return { from: zonedTimeToUtc(key, "00:00", timezone), to: zonedTimeToUtc(key, "23:59", timezone) };
}

/**
 * The coming Sat–Sun. On a Saturday or Sunday that means *this* weekend
 * (starting now), not the one seven days out.
 */
export function weekendWindow(now: Date, timezone = "America/Los_Angeles") {
  const dow = localDayOfWeek(now, timezone);
  const daysToSat = dow === 6 ? 0 : dow === 0 ? -1 : 6 - dow;
  const satMs = now.getTime() + daysToSat * 86_400_000;
  const satKey = localDateKey(new Date(satMs), timezone);
  const sunKey = localDateKey(new Date(satMs + 86_400_000), timezone);
  const from = dow === 0 ? zonedTimeToUtc(localDateKey(now, timezone), "00:00", timezone) : zonedTimeToUtc(satKey, "00:00", timezone);
  return { from, to: zonedTimeToUtc(sunKey, "23:59", timezone) };
}
