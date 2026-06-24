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

function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse "YYYY-MM-DDTHH:mm" into a local Date (date only) + "HH:mm" time. */
function parseDefault(s?: string): { date: Date | null; time: string } {
  if (!s) return { date: null, time: "" };
  const [datePart, timePart] = s.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return { date: null, time: timePart ?? "" };
  return { date: new Date(y, m - 1, d), time: (timePart ?? "").slice(0, 5) };
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Strip time so day comparisons are stable. */
function dayValue(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
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
}: {
  defaultStart?: string;
  defaultEnd?: string;
}) {
  const initStart = useMemo(() => parseDefault(defaultStart), [defaultStart]);
  const initEnd = useMemo(() => parseDefault(defaultEnd), [defaultEnd]);

  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState<Date | null>(initStart.date);
  const [endDate, setEndDate] = useState<Date | null>(initEnd.date);
  const [startTime, setStartTime] = useState(initStart.time || "09:00");
  const [endTime, setEndTime] = useState(initEnd.time || "17:00");

  const [viewYear, setViewYear] = useState(
    (initStart.date ?? today).getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(
    (initStart.date ?? today).getMonth()
  );

  const opensAt = startDate && startTime ? `${ymd(startDate)}T${startTime}` : "";
  const closesAt = endDate && endTime ? `${ymd(endDate)}T${endTime}` : "";

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
    // No start yet, or both endpoints already chosen → begin a fresh range.
    if (!startDate || (startDate && endDate)) {
      setStartDate(d);
      setEndDate(null);
      return;
    }
    // Have a start, no end. Clicking before the start restarts; after sets end.
    if (dayValue(d) < dayValue(startDate)) {
      setStartDate(d);
      setEndDate(null);
    } else if (!sameDay(d, startDate)) {
      setEndDate(d);
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
              <button
                type="button"
                onClick={() => pickDay(day)}
                className={[
                  "w-9 h-9 rounded-full text-sm transition grid place-items-center",
                  isStart || isEnd
                    ? "bg-brand text-white font-semibold"
                    : "text-ink hover:bg-brand-tint",
                ].join(" ")}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>

      {/* FROM / TO summary */}
      <div className="mt-6 pt-5 border-t border-line space-y-5">
        <SummaryRow
          label="FROM"
          date={startDate}
          time={startTime}
          onTime={setStartTime}
          timeLabel="Opens time"
        />
        <SummaryRow
          label="TO"
          date={endDate}
          time={endTime}
          onTime={setEndTime}
          timeLabel="Closes time"
        />
      </div>

      <input type="hidden" name="opensAt" value={opensAt} />
      <input type="hidden" name="closesAt" value={closesAt} />
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
      <div className="flex items-center gap-4">
        <span className="font-display text-4xl sm:text-5xl font-light text-brand w-14 tabular-nums">
          {date ? date.getDate() : "—"}
        </span>
        <div className="min-w-0 flex-1">
          {date ? (
            <>
              <p className="font-medium text-ink leading-tight">
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
        <div className="flex items-center gap-2 shrink-0">
          <ClockIcon />
          <input
            type="time"
            aria-label={timeLabel}
            value={time}
            onChange={(e) => onTime(e.target.value)}
            className="bg-paper border border-line rounded-xl px-3 py-2 text-ink font-medium focus:border-brand focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
