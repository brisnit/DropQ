"use client";

import { useState } from "react";
import { useActionState } from "react";
import { adminCreateLocationAction, type SubmitState } from "@/lib/actions/dropmeet";
import { LOCATION_TYPES, VERIFICATION_STATUSES } from "@/lib/dropmeet/types";

type Suggestion = {
  formatted: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  postalCode?: string;
};

const input =
  "w-full min-h-[48px] bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition";

/**
 * Admin place entry. Publishes on save — hence the mandatory provenance fields:
 * if we're asserting a place is real, we record where that claim came from.
 */
export function AdminPlaceForm() {
  const [state, formAction, pending] = useActionState<SubmitState, FormData>(
    adminCreateLocationAction,
    {}
  );
  const [address, setAddress] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  async function lookup(v: string) {
    setAddress(v);
    setPicked(null);
    if (v.trim().length < 4) return setSuggestions([]);
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(v)}`);
      if (res.ok) setSuggestions(((await res.json()) as { results?: Suggestion[] }).results ?? []);
    } catch {
      setSuggestions([]);
    }
  }

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-5 space-y-4 max-w-2xl">
      {picked && (
        <>
          <input type="hidden" name="latitude" value={picked.lat} />
          <input type="hidden" name="longitude" value={picked.lng} />
          <input type="hidden" name="city" value={picked.city ?? ""} />
          <input type="hidden" name="state" value={picked.state ?? ""} />
          <input type="hidden" name="postalCode" value={picked.postalCode ?? ""} />
        </>
      )}

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Name</span>
        <input name="name" required className={input} />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Category</span>
        <select name="locationType" className={input} defaultValue="market">
          {Object.entries(LOCATION_TYPES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
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
          autoComplete="off"
          className={input}
        />
        <p className="text-xs text-muted mt-1">
          {picked ? `✓ ${picked.lat.toFixed(5)}, ${picked.lng.toFixed(5)}` : "Pick a suggestion to pin coordinates."}
        </p>
        {suggestions.length > 0 && !picked && (
          <ul className="absolute z-20 inset-x-0 mt-1 bg-paper border border-line rounded-xl shadow-[var(--shadow-lift)] max-h-64 overflow-y-auto">
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

      <label className="block">
        <span className="block text-sm font-medium text-ink-soft mb-1.5">Description</span>
        <textarea name="description" rows={3} className={`${input} resize-y`} />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <input name="websiteUrl" placeholder="Website" className={input} />
        <input name="instagramUrl" placeholder="Instagram" className={input} />
        <input name="phone" placeholder="Phone" className={input} />
        <select name="verificationStatus" className={input} defaultValue="verified">
          {Object.entries(VERIFICATION_STATUSES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="border border-line rounded-xl p-4">
        <legend className="text-sm font-medium text-ink-soft px-1">Provenance</legend>
        <p className="text-xs text-muted mb-3">
          Where this information came from. Recorded so we can always answer how a record entered
          DropMeet.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <select name="sourceType" className={input} defaultValue="manual_research">
            <option value="manual_research">Manual research</option>
            <option value="organizer">From the organizer</option>
            <option value="import">Import</option>
            <option value="places_api">Places API</option>
          </select>
          <input name="sourceName" placeholder="Source name" className={input} />
          <input name="sourceUrl" placeholder="Source URL" className={input} />
        </div>
      </fieldset>

      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full min-h-[52px] rounded-xl bg-ink text-cream font-semibold disabled:opacity-50"
      >
        {pending ? "Saving…" : "Create and publish"}
      </button>
    </form>
  );
}
