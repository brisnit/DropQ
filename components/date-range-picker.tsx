"use client";

import { useMemo, useState } from "react";

/* ---------------------------------------------------------------------------
   Drop schedule picker — a single calendar where the vendor picks a FROM
   (opens) and TO (closes) date as a range, plus a time for each. Emits the
   combined "YYYY-MM-DDTHH:mm" values via hidden <input>s so the existing
   drop server action / validation keep working unchanged.
   Layout follows brand assets/Sell_In_Drops/Date_Time.png; colours use the
   app's coral brand instead of the screenshot's purple.
--------------------------------------------------------------------------- */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_SHORT = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAYS_LONG = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Offset (ms) of an IANA timezone at a given instant. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(map.year, map.month - 1, map.day, map.hour, map.minute, map.second);
  return asUTC - at.getTime();
}

/** Wall-clock (y, m0, d, hh, mm) in `timeZone` → UTC ISO instant. */
function zonedToUtcIso(
  y: number,
  m0: number,
  d: number,
  hh: number,
  mm: number,
  timeZone?: string
): string {
  if (!timeZone) return new Date(y, m0, d, hh, mm).toISOString();
  const guess = Date.UTC(y, m0, d, hh, mm);
  const off1 = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - off1;
  const off2 = tzOffsetMs(timeZone, new Date(utc)); // refine across DST edges
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc).toISOString();
}

/**
 * Parse a stored value into a Date (date only) + "HH:mm" time, expressed in
 * `timeZone` (or the viewer's local zone if none). Accepts an ISO instant or a
 * legacy local "YYYY-MM-DDTHH:mm" string.
 */
function parseDefault(
  s: string | undefined,
  timeZone?: string
): { date: Date | null; time: string } {
  if (!s) return { date: null, time: "" };
  if (/Z$|[+-]\d\d:?\d\d$/.test(s)) {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return { date: null, time: "" };
    if (timeZone) {
      const map: Record<string, number> = {};
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      for (const p of dtf.formatToParts(dt)) {
        if (p.type !== "literal") map[p.type] = Number(p.value);
      }
      return {
        date: new Date(map.year, map.month - 1, map.day),
        time: `${pad(map.hour)}:${pad(map.minute)}`,
      };
    }
    return {
      date: new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()),
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
    };
  }
  const [datePart, timePart = ""] = s.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return { date: null, time: timePart };
  return { date: new Date(y, m - 1, d), time: timePart.slice(0, 5) };
}

/** Combine a picked Date + "HH:mm" into a UTC ISO instant in `timeZone`. */
function toIsoInstant(date: Date, time: string, timeZone?: string): string {
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  return zonedToUtcIso(date.getFullYear(), date.getMonth(), date.getDate(), hh, mm, timeZone);
}

/** Strip time so day comparisons are stable. */
function dayValue(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Today's calendar date in `timeZone` — the vendor's STORE zone, not the
 * browser's. Every other date in this picker is already interpreted in the
 * store zone, so deriving "today" from the device would mark the wrong cell
 * for a vendor travelling or set to a different zone than their store. It also
 * keeps the server and client render in agreement, since both resolve the same
 * IANA zone rather than two different machine clocks.
 */
function todayInZone(timeZone?: string): Date {
  const now = new Date();
  if (!timeZone) return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const map: Record<string, number> = {};
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const p of dtf.formatToParts(now)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return new Date(map.year, map.month - 1, map.day);
}

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-brand">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DateRangePicker({
  defaultStart,
  defaultEnd,
  timeZone,
  startName = "opensAt",
  endName = "closesAt",
  fromLabel = "FROM",
  toLabel = "TO",
}: {
  defaultStart?: string;
  defaultEnd?: string;
  timeZone?: string;
  startName?: string;
  endName?: string;
  fromLabel?: string;
  toLabel?: string;
}) {
  const initStart = useMemo(() => parseDefault(defaultStart, timeZone), [defaultStart, timeZone]);
  const initEnd = useMemo(() => parseDefault(defaultEnd, timeZone), [defaultEnd, timeZone]);

  const today = useMemo(() => todayInZone(timeZone), [timeZone]);
  const [startDate, setStartDate] = useState<Date | null>(initStart.date);
  const [endDate, setEndDate] = useState<Date | null>(initEnd.date);
  const [startTime, setStartTime] = useState(initStart.time || "09:00");
  const [endTime, setEndTime] = useState(initEnd.time || "17:00");

  // "start" = next click begins a fresh (single-day) selection.
  // "end"   = next click can extend the current day into a multi-day range.
  const [phase, setPhase] = useState<"start" | "end">("start");

  const [viewYear, setViewYear] = useState(
    (initStart.date ?? today).getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(
    (initStart.date ?? today).getMonth()
  );

  // Emit proper UTC instants (computed in the vendor's timezone) so the server
  // stores the exact moment ordering opens/closes — not a UTC-misread wall clock.
  const opensAt = startDate && startTime ? toIsoInstant(startDate, startTime, timeZone) : "";
  const closesAt = endDate && endTime ? toIsoInstant(endDate, endTime, timeZone) : "";

  const years = useMemo(() => {
    const base = today.getFullYear();
    const set = new Set<number>();
    for (let y = base - 1; y <= base + 3; y++) set.add(y);
    if (startDate) set.add(startDate.getFullYear());
    if (endDate) set.add(endDate.getFullYear());
    set.add(viewYear);
    return [...set].sort((a, b) => a - b);
  }, [today, startDate, endDate, viewYear]);

  function shiftMonth(delta: number) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  }

  function pickDay(day: number) {
    const d = new Date(viewYear, viewMonth, day);

    // First click selects a single-day drop (opens and closes the same day).
    // The second click — on a later day — extends it into a multi-day range.
    if (phase === "start" || !startDate) {
      setStartDate(d);
      setEndDate(d);
      setPhase("end");
      return;
    }

    // phase === "end": a later day extends the range; the same/earlier day
    // restarts a fresh single-day selection.
    if (dayValue(d) > dayValue(startDate)) {
      setEndDate(d);
      setPhase("start");
    } else {
      setStartDate(d);
      setEndDate(d);
      setPhase("end");
    }
  }

  // Build the day grid (leading blanks + days of month).
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const sv = startDate ? dayValue(startDate) : null;
  const ev = endDate ? dayValue(endDate) : null;
  const tv = dayValue(today);
  const todayInView = today.getFullYear() === viewYear && today.getMonth() === viewMonth;

  return (
    <div className="bg-paper border border-line rounded-card p-5 sm:p-6 shadow-[var(--shadow-soft)]">
      {/* Month / year header */}
      <div className="flex items-center justify-between gap-2 mb-5">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="w-9 h-9 grid place-items-center rounded-full text-brand hover:bg-brand-tint transition text-xl"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          <select
            aria-label="Month"
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className="appearance-none bg-paper border border-line rounded-xl px-3 py-1.5 font-medium text-ink focus:border-brand focus:outline-none cursor-pointer"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i}>{m}</option>
            ))}
          </select>
          <select
            aria-label="Year"
            value={viewYear}
            onChange={(e) => setViewYear(Number(e.target.value))}
            className="appearance-none bg-paper border border-line rounded-xl px-3 py-1.5 font-medium text-ink focus:border-brand focus:outline-none cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="w-9 h-9 grid place-items-center rounded-full text-brand hover:bg-brand-tint transition text-xl"
        >
          ›
        </button>
      </div>

      {/* Weekday labels */}
      <div className="grid grid-cols-7 text-center text-xs font-semibold text-muted mb-1">
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="py-1">{w}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (day === null) return <div key={`b${idx}`} className="h-11" />;
          const dv = dayValue(new Date(viewYear, viewMonth, day));
          const isStart = sv !== null && dv === sv;
          const isEnd = ev !== null && dv === ev;
          const isToday = dv === tv;
          const inRange = sv !== null && ev !== null && dv > sv && dv < ev;
          const col = idx % 7;
          const banded = isStart || isEnd || inRange;
          const roundL = isStart || (ev !== null && col === 0 && (inRange || isEnd));
          const roundR = isEnd || (sv !== null && col === 6 && (inRange || isStart));

          return (
            <div
              key={day}
              className={[
                "h-11 flex items-center justify-center",
                banded && (inRange || (isStart && ev !== null) || (isEnd && sv !== null))
                  ? "bg-brand-tint"
                  : "",
                roundL ? "rounded-l-full" : "",
                roundR ? "rounded-r-full" : "",
              ].join(" ")}
            >
              {/* Three states that must stay distinguishable, including when two
                  of them land on the same day:
                    selected  — solid brand fill (always the strongest)
                    today     — brand ring + brand text, plus a dot
                    both      — the fill wins, and the dot turns white so the
                                day still reads as today rather than the ring
                                being painted over
                  The dot carries the meaning on its own, so the state does not
                  depend on colour alone. */}
              <button
                type="button"
                onClick={() => pickDay(day)}
                aria-current={isToday ? "date" : undefined}
                aria-label={`${WEEKDAYS_LONG[(firstWeekday + day - 1) % 7]}, ${MONTHS[viewMonth]} ${day}, ${viewYear}${isToday ? " (today)" : ""}`}
                className={[
                  "relative w-9 h-9 rounded-full text-sm transition grid place-items-center",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-1 focus-visible:ring-offset-paper",
                  isStart || isEnd
                    ? "bg-brand text-white font-semibold"
                    : isToday
                      // Deliberately NOT `text-brand`: coral on paper is
                      // 2.92:1, under AA for 14px bold. The ring and the dot
                      // carry "today" instead, in brand-dark (3.69:1, over the
                      // 3:1 that non-text indicators need), and the number
                      // stays ink.
                      ? "text-ink font-semibold ring-1 ring-brand-dark hover:bg-brand-tint"
                      : "text-ink hover:bg-brand-tint",
                ].join(" ")}
              >
                {day}
                {isToday && (
                  <span
                    aria-hidden
                    className={[
                      "absolute bottom-1 w-1 h-1 rounded-full",
                      isStart || isEnd ? "bg-white" : "bg-brand-dark",
                    ].join(" ")}
                  />
                )}
              </button>
            </div>
          );
        })}
      </div>

      {todayInView && (
        <p className="flex items-center gap-1.5 mt-2 text-xs text-muted">
          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-brand-dark" />
          Today
        </p>
      )}

      {/* FROM / TO summary */}
      <div className="mt-6 pt-5 border-t border-line space-y-5">
        <SummaryRow
          label={fromLabel}
          date={startDate}
          time={startTime}
          onTime={setStartTime}
          timeLabel={`${fromLabel} time`}
        />
        <SummaryRow
          label={toLabel}
          date={endDate}
          time={endTime}
          onTime={setEndTime}
          timeLabel={`${toLabel} time`}
        />
      </div>

      {timeZone && (
        <p className="mt-4 text-xs text-muted text-center">
          Times are in <span className="font-medium text-ink-soft">{timeZone.replace(/_/g, " ")}</span> (your store timezone).
        </p>
      )}

      <input type="hidden" name={startName} value={opensAt} />
      <input type="hidden" name={endName} value={closesAt} />
    </div>
  );
}

function SummaryRow({
  label,
  date,
  time,
  onTime,
  timeLabel,
}: {
  label: string;
  date: Date | null;
  time: string;
  onTime: (v: string) => void;
  timeLabel: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-wide text-muted mb-1">{label}</p>
      {/* Date group + time group wrap onto separate lines when the row is too
          narrow, so the date copy never gets squeezed into the time picker. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-4">
          <span className="font-display text-4xl sm:text-5xl font-light text-brand w-14 tabular-nums shrink-0">
            {date ? date.getDate() : "—"}
          </span>
          <div>
            {date ? (
              <>
                <p className="font-medium text-ink leading-tight whitespace-nowrap">
                  {MONTHS[date.getMonth()]} {date.getFullYear()}
                </p>
                <p className="text-sm text-muted">{WEEKDAYS_LONG[date.getDay()]}</p>
              </>
            ) : (
              <p className="text-muted">
                {label === "FROM" ? "Pick a start date above" : "Pick an end date above"}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <ClockIcon />
          <TimeSelect value={time} onChange={onTime} label={timeLabel} />
        </div>
      </div>
    </div>
  );
}

const HOURS12 = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59

/** Combine a 12-hour selection back into the "HH:mm" 24-hour value we store. */
function to24(hour12: number, minute: number, mer: "AM" | "PM") {
  let h = hour12 % 12;
  if (mer === "PM") h += 12;
  return `${pad(h)}:${pad(minute)}`;
}

/* On-brand time picker — three styled selects (hour / minute / AM-PM) instead
   of the native <input type="time"> spinner, so it matches the rest of the UI. */
function TimeSelect({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [hStr = "09", mStr = "00"] = (value || "09:00").split(":");
  const h24 = Number(hStr) || 0;
  const minute = Number(mStr) || 0;
  const mer: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const hour12 = ((h24 + 11) % 12) + 1;

  const cls =
    "appearance-none text-center bg-paper border border-line rounded-xl px-2.5 py-2 text-ink font-medium focus:border-brand focus:outline-none cursor-pointer";

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label={`${label} hour`}
        value={hour12}
        onChange={(e) => onChange(to24(Number(e.target.value), minute, mer))}
        className={cls}
      >
        {HOURS12.map((h) => (
          <option key={h} value={h}>{pad(h)}</option>
        ))}
      </select>
      <span className="font-semibold text-muted">:</span>
      <select
        aria-label={`${label} minute`}
        value={minute}
        onChange={(e) => onChange(to24(hour12, Number(e.target.value), mer))}
        className={cls}
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>{pad(m)}</option>
        ))}
      </select>
      <select
        aria-label={`${label} AM or PM`}
        value={mer}
        onChange={(e) => onChange(to24(hour12, minute, e.target.value as "AM" | "PM"))}
        className={cls}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}
