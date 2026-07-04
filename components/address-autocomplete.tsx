"use client";

import { useEffect, useRef, useState } from "react";

type Result = {
  formatted: string;
  name?: string;
  lat: number;
  lng: number;
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

type Structured = {
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

const inputCls =
  "w-full bg-paper border border-line-strong rounded-lg px-3 py-2 text-ink placeholder:text-muted/70 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/**
 * Address input with autocomplete. Submits `pickupAddress` (the text — free text
 * is allowed if the seller doesn't pick a suggestion) plus hidden `pickupLat` /
 * `pickupLng` when a suggestion is chosen.
 */
export function AddressAutocomplete({
  defaultAddress = "",
  defaultLat = null,
  defaultLng = null,
  defaultStructured = {},
  placeholder = "Search a pickup address…",
}: {
  defaultAddress?: string;
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultStructured?: Structured;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(defaultAddress);
  const [lat, setLat] = useState<number | null>(defaultLat);
  const [lng, setLng] = useState<number | null>(defaultLng);
  // Structured components — preserved on load, cleared on typing, set on pick.
  const [structured, setStructured] = useState<Structured>(defaultStructured);
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const onType = (v: string) => {
    setQuery(v);
    setLat(null); // typing invalidates any previously-selected coordinates
    setLng(null);
    setStructured({});
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length < 3) {
      setResults([]);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/places?q=${encodeURIComponent(v)}`);
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);
  };

  const pick = (r: Result) => {
    setQuery(r.formatted);
    setLat(r.lat);
    setLng(r.lng);
    setStructured({
      line1: r.line1,
      city: r.city,
      state: r.state,
      postalCode: r.postalCode,
      country: r.country,
    });
    setResults([]);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        name="pickupAddress"
        value={query}
        onChange={(e) => onType(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        className={inputCls}
        autoComplete="off"
      />
      <input type="hidden" name="pickupLat" value={lat ?? ""} />
      <input type="hidden" name="pickupLng" value={lng ?? ""} />
      <input type="hidden" name="pickupLine1" value={structured.line1 ?? ""} />
      <input type="hidden" name="pickupCity" value={structured.city ?? ""} />
      <input type="hidden" name="pickupState" value={structured.state ?? ""} />
      <input type="hidden" name="pickupPostal" value={structured.postalCode ?? ""} />
      <input type="hidden" name="pickupCountry" value={structured.country ?? ""} />
      {open && (results.length > 0 || loading) && (
        <ul className="absolute z-20 mt-1 w-full bg-paper border border-line rounded-xl shadow-[var(--shadow-lift)] max-h-64 overflow-auto">
          {loading && results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">Searching…</li>
          )}
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-cream border-b border-line/50 last:border-0"
              >
                {r.formatted}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted mt-1">Pick a suggestion for a mapped location, or type any address.</p>
    </div>
  );
}
