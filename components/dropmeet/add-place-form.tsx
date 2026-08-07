"use client";

import { useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { submitLocationAction, submitMarketAction, type SubmitState } from "@/lib/actions/dropmeet";
import { LOCATION_TYPES, MARKET_TYPES } from "@/lib/dropmeet/types";
import { track } from "@/lib/analytics";

/**
 * Community "add a place" form.
 *
 * Two things it is careful about: it never promises the place will appear (it
 * won't, until an admin approves it), and it captures coordinates from the
 * address autocomplete so the server has a precise point to region-check —
 * while the server re-validates regardless of what's posted.
 */

type Suggestion = {
  formatted: string;
  lat: number;
  lng: number;
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

const input =
  "w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

export function AddPlaceForm({ signedIn }: { signedIn: boolean }) {
  const [mode, setMode] = useState<"location" | "market">("location");
  const [locState, locAction, locPending] = useActionState<SubmitState, FormData>(
    submitLocationAction,
    {}
  );
  const [mktState, mktAction, mktPending] = useActionState<SubmitState, FormData>(
    submitMarketAction,
    {}
  );

  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);

  const state = mode === "location" ? locState : mktState;
  const pending = mode === "location" ? locPending : mktPending;

  async function lookup(value: string) {
    setAddress(value);
    setPicked(null);
    if (value.trim().length < 4) {
      setSuggestions([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(value)}`);
      if (res.ok) setSuggestions(((await res.json()) as { results?: Suggestion[] }).results ?? []);
    } catch {
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  }

  if (!signedIn) {
    return (
      <div className="bg-paper border border-line rounded-card p-6 text-center">
        <div className="text-3xl">📍</div>
        <h2 className="font-display text-xl font-semibold mt-2">Sign in to add a place</h2>
        <p className="text-muted mt-2 text-sm">
          We ask so we can follow up if we have a question about your submission.
        </p>
        <div className="flex flex-wrap gap-2 justify-center mt-5">
          <Link
            href="/messages/login?next=%2Fdropmeet%2Fadd"
            className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
          >
            Sign in as a shopper
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill border border-line-strong text-sm font-semibold"
          >
            Sign in as a vendor
          </Link>
        </div>
      </div>
    );
  }

  if (state.ok) {
    return (
      <div className="bg-paper border border-line rounded-card p-6 text-center">
        <div className="text-3xl">🎉</div>
        <h2 className="font-display text-xl font-semibold mt-2">Thanks — it&apos;s in review</h2>
        <p className="text-muted mt-2">
          Your submission is <b>Pending DropQ Review</b>. It won&apos;t show up on the map or in
          search until our team approves it — usually within a day or two.
        </p>
        <Link
          href="/dropmeet"
          className="mt-5 inline-flex items-center justify-center min-h-[48px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          Back to DropMeet
        </Link>
      </div>
    );
  }

  return (
    <form
      action={mode === "location" ? locAction : mktAction}
      onSubmit={() => track(mode === "location" ? "location_submitted" : "market_submitted", {})}
      className="bg-paper border border-line rounded-card p-5 sm:p-6 space-y-4"
    >
      {/* Coordinates captured from autocomplete; the server re-checks them. */}
      {picked && (
        <>
          <input type="hidden" name="latitude" value={picked.lat} />
          <input type="hidden" name="longitude" value={picked.lng} />
          <input type="hidden" name="city" value={picked.city ?? ""} />
          <input type="hidden" name="state" value={picked.state ?? ""} />
          <input type="hidden" name="postalCode" value={picked.postalCode ?? ""} />
        </>
      )}

      <div className="flex gap-2">
        {(["location", "market"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 min-h-[44px] rounded-xl text-sm font-semibold border transition ${
              mode === m ? "bg-ink text-cream border-ink" : "bg-paper border-line-strong text-ink-soft"
            }`}
          >
            {m === "location" ? "A place" : "A market"}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted">
        {mode === "location"
          ? "A brewery, church, park, shop — anywhere local vendors gather or sell."
          : "A recurring market: farmers, flea, vintage, makers, swap meet."}
      </p>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">
          {mode === "location" ? "Place name" : "Market name"}
        </span>
        <input name="name" required placeholder="Little Italy Mercato" className={input} />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Category</span>
        <select name={mode === "location" ? "locationType" : "marketType"} className={input} defaultValue="">
          <option value="" disabled>
            Choose one…
          </option>
          {Object.entries(mode === "location" ? LOCATION_TYPES : MARKET_TYPES).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div className="relative">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Address</span>
        <input
          name="address"
          required
          value={address}
          onChange={(e) => lookup(e.target.value)}
          placeholder="600 W Date St, San Diego, CA"
          autoComplete="off"
          className={input}
        />
        <p className="text-xs text-muted mt-1">
          {searching
            ? "Looking…"
            : picked
              ? "✓ Location pinned"
              : "Pick a suggestion so we can put it on the map."}
        </p>
        {suggestions.length > 0 && !picked && (
          <ul className="absolute z-20 left-0 right-0 mt-1 bg-paper border border-line rounded-xl shadow-[var(--shadow-lift)] overflow-hidden max-h-64 overflow-y-auto">
            {suggestions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(s);
                    setAddress(s.formatted);
                    setSuggestions([]);
                  }}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-cream min-h-[48px]"
                >
                  {s.formatted}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {mode === "market" && (
        <fieldset className="border border-line rounded-xl p-4">
          <legend className="text-sm font-medium text-ink-soft px-1">Schedule (optional)</legend>
          <div className="grid grid-cols-3 gap-2">
            <select name="dayOfWeek" className={input} defaultValue="">
              <option value="">Day…</option>
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                (d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                )
              )}
            </select>
            <input name="startTime" type="time" aria-label="Opens" className={input} />
            <input name="endTime" type="time" aria-label="Closes" className={input} />
          </div>
          <select name="recurrence" className={`${input} mt-2`} defaultValue="weekly">
            <option value="weekly">Every week</option>
            <option value="monthly">Monthly</option>
            <option value="seasonal">Seasonal</option>
            <option value="one_time">One time</option>
          </select>
        </fieldset>
      )}

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Description</span>
        <textarea
          name="description"
          rows={3}
          placeholder="What happens here? Who sells?"
          className={`${input} resize-y`}
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <input name="websiteUrl" placeholder="Website (optional)" className={input} />
        <input name="instagramUrl" placeholder="Instagram (optional)" className={input} />
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">
          Anything else for our team?
        </span>
        <textarea name="notes" rows={2} placeholder="Optional notes" className={`${input} resize-y`} />
      </label>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}

      <p className="text-xs text-muted">
        DropMeet covers San Diego County only right now. Submissions are reviewed by the DropQ team
        before they appear.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full min-h-[52px] rounded-xl bg-ink text-cream font-semibold disabled:opacity-50 transition active:scale-[0.99]"
      >
        {pending ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
