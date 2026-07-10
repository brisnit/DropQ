"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiscoveryItem } from "@/lib/discover";
import { DiscoveryCard } from "@/components/discovery-card";
import { getSaved } from "@/lib/saved-store";
import { track, getOriginatingVendor } from "@/lib/analytics";

const RADII = [10, 25, 50, 100];
const DEFAULT_RADIUS = 25;
const LOC_KEY = "dropq_discover_loc";

type Loc = { lat?: number; lng?: number; label: string; radius: number };

const FILTERS: { id: string; label: string; category?: string; when?: string }[] = [
  { id: "all", label: "All" },
  { id: "food", label: "Food & Beverage", category: "food" },
  { id: "collectibles", label: "Collectibles", category: "collectibles" },
  { id: "art", label: "Art & Handmade", category: "art" },
  { id: "apparel", label: "Vintage & Apparel", category: "apparel" },
  { id: "events", label: "Pop-Ups & Markets", category: "events" },
  { id: "today", label: "Available Today", when: "today" },
  { id: "weekend", label: "This Weekend", when: "weekend" },
  { id: "saved", label: "★ Saved" },
];

function loadLoc(): Loc | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LOC_KEY);
    return raw ? (JSON.parse(raw) as Loc) : null;
  } catch {
    return null;
  }
}
function persistLoc(loc: Loc) {
  try { localStorage.setItem(LOC_KEY, JSON.stringify(loc)); } catch { /* ignore */ }
}

export function DiscoverClient() {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [saved, setSavedItems] = useState<DiscoveryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zip, setZip] = useState("");
  const [editingLoc, setEditingLoc] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);
  const ready = useRef(false);

  // Restore persisted location + saved items on mount.
  useEffect(() => {
    track("discovery_viewed");
    const stored = loadLoc();
    if (stored) setLoc(stored);
    else setEditingLoc(true);
    setSavedItems(getSaved());
    ready.current = true;
  }, []);

  const activeFilter = FILTERS.find((f) => f.id === filter);

  const fetchItems = useCallback(async (l: Loc, f: typeof activeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (l.lat != null && l.lng != null) { qs.set("lat", String(l.lat)); qs.set("lng", String(l.lng)); }
      else if (l.label) qs.set(/^\d{4,5}$/.test(l.label) ? "zip" : "city", l.label);
      qs.set("radius", String(l.radius));
      if (l.label) qs.set("label", l.label);
      if (f?.category) qs.set("category", f.category);
      if (f?.when) qs.set("when", f.when);

      const res = await fetch(`/api/discover?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.error === "not_found") {
        setError(data.message || "We couldn't find that location.");
        setItems([]);
      } else {
        setItems(data.items ?? []);
        // Persist resolved coordinates (e.g. after a ZIP geocode).
        if (data.location?.lat != null && (l.lat == null || l.lng == null)) {
          const resolved: Loc = { lat: data.location.lat, lng: data.location.lng, label: data.location.label || l.label, radius: l.radius };
          setLoc(resolved);
          persistLoc(resolved);
        }
      }
    } catch {
      setError("Something went wrong loading drops. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch whenever location or a (non-saved) filter changes.
  useEffect(() => {
    if (!ready.current || !loc || filter === "saved") return;
    fetchItems(loc, activeFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc, filter]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoDenied(true); return; }
    track("location_permission_requested");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        track("location_permission_accepted");
        const next: Loc = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: "your location", radius: loc?.radius ?? DEFAULT_RADIUS };
        setLoc(next); persistLoc(next); setEditingLoc(false); setGeoDenied(false);
      },
      () => { track("location_permission_denied"); setGeoDenied(true); }
    );
  };

  const searchZip = (e: React.FormEvent) => {
    e.preventDefault();
    const val = zip.trim();
    if (!val) return;
    track("zip_searched", { value: val });
    const next: Loc = { label: val, radius: loc?.radius ?? DEFAULT_RADIUS };
    setLoc(next); setEditingLoc(false);
  };

  const changeRadius = (r: number) => {
    if (!loc) return;
    track("radius_changed", { radius: r });
    const next = { ...loc, radius: r };
    setLoc(next); persistLoc(next);
  };

  const selectFilter = (id: string) => {
    setFilter(id);
    if (id === "saved") setSavedItems(getSaved());
    else track("category_filter_selected", { filter: id });
  };

  const origin = typeof window !== "undefined" ? getOriginatingVendor() : null;
  const shown = filter === "saved" ? saved : items;

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="text-center max-w-xl mx-auto">
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight">Find Drops Near You</h1>
        <p className="text-ink-soft mt-2">
          Discover local vendors, product drops, pop-ups, and markets happening near you.
        </p>
      </div>

      {/* Location bar */}
      <div className="mt-6 max-w-xl mx-auto">
        {loc && !editingLoc ? (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-paper border border-line rounded-card px-4 py-3">
            <p className="text-sm">
              📍 Showing drops near <span className="font-semibold">{loc.label}</span>
            </p>
            <button onClick={() => setEditingLoc(true)} className="text-sm font-medium text-brand hover:underline">
              Change location
            </button>
          </div>
        ) : (
          <div className="bg-paper border border-line rounded-card p-5">
            <button
              onClick={useMyLocation}
              className="w-full text-sm font-semibold rounded-xl py-3 bg-ink text-cream hover:bg-ink-soft transition"
            >
              📍 Use my location
            </button>
            {geoDenied && (
              <p className="text-xs text-muted mt-2 text-center">
                Location unavailable — enter a ZIP code or city below.
              </p>
            )}
            <div className="flex items-center gap-3 my-3 text-xs text-muted">
              <span className="flex-1 border-t border-line" /> or <span className="flex-1 border-t border-line" />
            </div>
            <form onSubmit={searchZip} className="flex gap-2">
              <input
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="ZIP code or city"
                className="flex-1 bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:border-ink/40"
              />
              <button type="submit" className="text-sm font-semibold rounded-xl px-4 bg-brand text-white hover:bg-brand-dark transition">
                Search
              </button>
            </form>
          </div>
        )}

        {/* Radius */}
        {loc && !editingLoc && (
          <div className="flex items-center gap-2 mt-3 justify-center flex-wrap">
            <span className="text-xs text-muted">Within</span>
            {RADII.map((r) => (
              <button
                key={r}
                onClick={() => changeRadius(r)}
                className={`text-xs font-medium px-3 py-1.5 rounded-pill border transition ${
                  loc.radius === r ? "bg-ink text-cream border-ink" : "border-line-strong text-ink-soft hover:border-ink/30"
                }`}
              >
                {r} mi
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="mt-6 flex gap-2 overflow-x-auto pb-1 -mx-5 px-5 sm:justify-center sm:flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => selectFilter(f.id)}
            className={`shrink-0 text-sm font-medium px-3.5 py-1.5 rounded-pill border transition ${
              filter === f.id ? "bg-ink text-cream border-ink" : "bg-paper border-line-strong text-ink-soft hover:border-ink/30"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="mt-6">
        {filter !== "saved" && !loc ? (
          <PromptState />
        ) : loading ? (
          <div className="text-center py-16 text-muted">Loading drops near you…</div>
        ) : error ? (
          <div className="text-center py-16">
            <p className="text-ink-soft">{error}</p>
            <button onClick={() => setEditingLoc(true)} className="mt-3 text-brand font-medium hover:underline">Change location</button>
          </div>
        ) : shown.length === 0 ? (
          filter === "saved" ? (
            <div className="text-center py-16 text-muted">
              <div className="text-4xl">🔖</div>
              <p className="mt-3 font-medium text-ink-soft">No saved drops yet</p>
              <p className="text-sm mt-1">Tap the tag on any drop to save it here — no account needed.</p>
            </div>
          ) : (
            <EmptyState
              onExpand={() => loc && changeRadius(Math.min(100, RADII[RADII.indexOf(loc.radius) + 1] ?? 100))}
              onChange={() => setEditingLoc(true)}
              onUpcoming={() => selectFilter("weekend")}
              origin={origin}
            />
          )
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((it) => <DiscoveryCard key={`${it.kind}-${it.id}`} item={it} />)}
            </div>
            {filter === "saved" && (
              <p className="text-center text-xs text-muted mt-6">
                Saved on this device. No account required.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromptState() {
  return (
    <div className="text-center py-14 max-w-sm mx-auto text-muted">
      <div className="text-4xl">🗺️</div>
      <p className="mt-3 font-medium text-ink-soft">Where are you looking?</p>
      <p className="text-sm mt-1">Use your location or enter a ZIP code to find drops, pop-ups, and markets nearby.</p>
    </div>
  );
}

function EmptyState({
  onExpand, onChange, onUpcoming, origin,
}: {
  onExpand: () => void;
  onChange: () => void;
  onUpcoming: () => void;
  origin: { id: string; slug: string | null } | null;
}) {
  return (
    <div className="text-center py-14 max-w-md mx-auto">
      <div className="text-4xl">🧭</div>
      <h2 className="font-display text-xl font-semibold mt-3">No active drops found nearby yet.</h2>
      <p className="text-muted mt-2">
        Try expanding your search area or check back soon as new vendors join DropQ.
      </p>
      <div className="mt-6 flex flex-wrap gap-2 justify-center">
        <button onClick={onExpand} className="text-sm font-semibold rounded-pill px-4 py-2 bg-ink text-cream hover:bg-ink-soft transition">
          Expand search radius
        </button>
        <button onClick={onChange} className="text-sm font-medium rounded-pill px-4 py-2 border border-line-strong hover:border-ink/30 transition">
          Change location
        </button>
        <button onClick={onUpcoming} className="text-sm font-medium rounded-pill px-4 py-2 border border-line-strong hover:border-ink/30 transition">
          View upcoming markets
        </button>
        {origin?.slug && (
          <Link href={`/s/${origin.slug}`} className="text-sm font-medium rounded-pill px-4 py-2 border border-line-strong hover:border-ink/30 transition">
            Back to previous vendor
          </Link>
        )}
      </div>
    </div>
  );
}
