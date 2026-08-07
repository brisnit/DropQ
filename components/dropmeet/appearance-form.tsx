"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { createAppearanceAction, type AppearanceState } from "@/lib/actions/dropmeet";
import { track } from "@/lib/analytics";

type PlaceOption = {
  id: string;
  kind: "market" | "location" | "event";
  name: string;
  subtitle: string;
  /** Market opening hours, used as sensible defaults. */
  defaultStart?: string | null;
  defaultEnd?: string | null;
};

type DropOption = { id: string; title: string; status: string };

const input =
  "w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

/**
 * "Where will you be?" — search approved DropMeet places, pick a date, attach a
 * drop. Only approved places are searchable, which is what stops a vendor
 * self-publishing a place by submitting it and immediately appearing there.
 */
export function AppearanceForm({ drops }: { drops: DropOption[] }) {
  const [state, formAction, pending] = useActionState<AppearanceState, FormData>(
    createAppearanceAction,
    {}
  );
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlaceOption[]>([]);
  const [picked, setPicked] = useState<PlaceOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/dropmeet/places?q=${encodeURIComponent(q)}`);
        if (res.ok && !cancelled) {
          setResults(((await res.json()) as { results: PlaceOption[] }).results ?? []);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, picked]);

  if (state.ok) {
    return (
      <div className="bg-paper border border-line rounded-card p-6 text-center">
        <div className="text-3xl">📍</div>
        <p className="font-display text-lg font-semibold mt-2">Appearance added</p>
        <p className="text-sm text-muted mt-1">
          It&apos;s live on DropMeet now — customers browsing that place will see you.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          Add another
        </button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => track("vendor_appearance_created", { kind: picked?.kind })}
      className="bg-paper border border-line rounded-card p-5 space-y-4"
    >
      {picked && (
        <input
          type="hidden"
          name={picked.kind === "market" ? "marketId" : picked.kind === "event" ? "eventId" : "locationId"}
          value={picked.id}
        />
      )}

      <div className="relative">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Where will you be?</span>
        {picked ? (
          <div className="flex items-center justify-between gap-3 border border-line-strong rounded-xl px-3.5 py-3 bg-cream/60">
            <div className="min-w-0">
              <p className="font-medium truncate">{picked.name}</p>
              <p className="text-xs text-muted truncate">{picked.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setQ("");
              }}
              className="text-sm text-muted hover:text-ink shrink-0"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search DropMeet — markets, places, events"
              autoComplete="off"
              className={input}
            />
            {searching && <p className="text-xs text-muted mt-1">Searching…</p>}
            {results.length > 0 && (
              <ul className="absolute z-20 left-0 right-0 mt-1 bg-paper border border-line rounded-xl shadow-[var(--shadow-lift)] overflow-hidden max-h-64 overflow-y-auto">
                {results.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(r);
                        setResults([]);
                        // A known market's hours are the sensible default.
                        if (r.defaultStart) setStart(r.defaultStart);
                        if (r.defaultEnd) setEnd(r.defaultEnd);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-cream min-h-[56px]"
                    >
                      <span className="block text-sm font-medium">{r.name}</span>
                      <span className="block text-xs text-muted">{r.subtitle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!searching && q.trim().length >= 2 && results.length === 0 && (
              <div className="mt-2 text-sm text-muted">
                Can&apos;t find your location?{" "}
                <Link href="/dropmeet/add" className="text-brand font-semibold hover:underline">
                  Add it
                </Link>{" "}
                — our team reviews it before it goes live.
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">Date</span>
          <input name="date" type="date" required className={input} />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">From</span>
          <input
            name="startTime"
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={input}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-ink-soft mb-1.5">To</span>
          <input
            name="endTime"
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={input}
          />
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">
          Drop for preorders (optional)
        </span>
        <select name="dropId" className={input} defaultValue="">
          <option value="">No drop attached</option>
          {drops.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title} {d.status === "live" ? "(live)" : `(${d.status})`}
            </option>
          ))}
        </select>
        <span className="block text-xs text-muted mt-1">
          Attach a drop and customers see a Preorder button on the DropMeet page.
        </span>
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <input name="boothInfo" placeholder="Booth / stall (optional)" className={input} />
        <input name="notes" placeholder="Note for customers (optional)" className={input} />
      </div>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending || !picked}
        className="w-full min-h-[52px] rounded-xl bg-ink text-cream font-semibold disabled:opacity-40 disabled:pointer-events-none transition active:scale-[0.99]"
      >
        {pending ? "Adding…" : "Add appearance"}
      </button>
    </form>
  );
}
