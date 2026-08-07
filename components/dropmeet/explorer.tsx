"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DropMeetMap } from "@/components/dropmeet/map";
import { DropMeetCard } from "@/components/dropmeet/card";
import { FILTERS, type DropMeetItem, type FilterKey } from "@/lib/dropmeet/types";
import { track } from "@/lib/analytics";

/**
 * The DropMeet browse experience.
 *
 * Desktop: list on the left, map on the right, hovering a card highlights its
 * pin. Mobile: full-bleed map with a draggable bottom sheet over it — the sheet
 * is the primary surface, because on a phone you're reading results, not
 * panning a map.
 */

type Sheet = "peek" | "half" | "full";

const SHEET_CLASS: Record<Sheet, string> = {
  peek: "h-[38dvh]",
  half: "h-[62dvh]",
  full: "h-[88dvh]",
};

export function DropMeetExplorer({
  initialItems,
  regionName,
}: {
  initialItems: DropMeetItem[];
  regionName: string;
}) {
  const [items, setItems] = useState(initialItems);
  const [filters, setFilters] = useState<FilterKey[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DropMeetItem | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>("peek");
  const [loading, setLoading] = useState(false);

  const boundsRef = useRef<{ minLat: number; minLng: number; maxLat: number; maxLng: number } | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    track("dropmeet_opened", { surface: "dropmeet" });
  }, []);

  const refresh = useCallback(async () => {
    const id = ++reqRef.current;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      const b = boundsRef.current;
      if (b) {
        p.set("minLat", String(b.minLat));
        p.set("minLng", String(b.minLng));
        p.set("maxLat", String(b.maxLat));
        p.set("maxLng", String(b.maxLng));
      }
      if (filters.length) p.set("filters", filters.join(","));
      if (query.trim()) p.set("q", query.trim());

      const res = await fetch(`/api/dropmeet/feed?${p}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: DropMeetItem[] };
      // Ignore a response that a newer request has already superseded.
      if (id === reqRef.current) setItems(data.items);
    } catch {
      /* keep whatever is on screen */
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, [filters, query]);

  // Filters and search re-query immediately; search is debounced.
  useEffect(() => {
    const t = setTimeout(refresh, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [refresh, query]);

  const toggleFilter = (key: FilterKey) => {
    setFilters((prev) => {
      const on = prev.includes(key);
      const next = on ? prev.filter((f) => f !== key) : [...prev, key];
      if (!on) track("category_filter_selected", { filter: key, surface: "dropmeet" });
      return next;
    });
  };

  const onBoundsChange = useCallback(
    (b: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => {
      boundsRef.current = b;
      track("map_moved", { surface: "dropmeet" });
      refresh();
    },
    [refresh]
  );

  const highlighted = hovered ?? selected?.id ?? null;
  const counts = useMemo(
    () => ({
      total: items.length,
      preorder: items.reduce((s, i) => s + (i.preorderCount > 0 ? 1 : 0), 0),
    }),
    [items]
  );

  const list = (
    <>
      {items.length === 0 ? (
        <div className="p-8 text-center">
          <div className="text-4xl">🧭</div>
          <p className="font-display font-semibold mt-3">Nothing here yet</p>
          <p className="text-sm text-muted mt-1 max-w-xs mx-auto">
            {filters.length || query
              ? "Try clearing a filter or zooming out."
              : `DropMeet is just getting started in ${regionName}. Know a market or gathering place we're missing?`}
          </p>
          <Link
            href="/dropmeet/add"
            className="mt-5 inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
          >
            Add a place
          </Link>
        </div>
      ) : (
        items.map((i) => (
          <DropMeetCard key={i.id} item={i} active={highlighted === i.id} onHover={setHovered} />
        ))
      )}
    </>
  );

  return (
    <div className="lg:grid lg:grid-cols-[420px_1fr] lg:h-[calc(100dvh_-_3.5rem)]">
      {/* ── Desktop list column ────────────────────────────────────────── */}
      <aside className="hidden lg:flex lg:flex-col lg:h-full lg:min-h-0 border-r border-line bg-paper">
        <Header
          regionName={regionName}
          query={query}
          setQuery={setQuery}
          filters={filters}
          toggleFilter={toggleFilter}
          counts={counts}
          loading={loading}
        />
        <div className="flex-1 min-h-0 overflow-y-auto">{list}</div>
      </aside>

      {/* ── Map ────────────────────────────────────────────────────────── */}
      <div className="relative h-[100dvh] lg:h-full">
        <DropMeetMap
          items={items}
          selectedId={selected?.id ?? hovered ?? null}
          onSelect={(item) => {
            setSelected(item);
            if (item) {
              setSheet("half");
              track("vendor_appearance_viewed", { kind: item.kind, surface: "dropmeet_map" });
            }
          }}
          onBoundsChange={onBoundsChange}
          className="absolute inset-0"
        />

        {/* Mobile search + filters float over the map */}
        <div className="lg:hidden absolute top-0 inset-x-0 z-10 p-3 pointer-events-none">
          <div className="pointer-events-auto">
            <SearchBox query={query} setQuery={setQuery} elevated />
            <FilterRow filters={filters} toggleFilter={toggleFilter} elevated />
          </div>
        </div>

        {/* Marker preview — lifts above the sheet, never traps the user */}
        {selected && (
          <div className="absolute inset-x-0 bottom-0 lg:bottom-6 lg:inset-x-auto lg:left-6 lg:max-w-sm z-30 p-3 lg:p-0">
            <div className="bg-paper border border-line rounded-card shadow-[var(--shadow-lift)] overflow-hidden">
              <div className="flex items-start justify-between gap-2 p-4 pb-2">
                <div className="min-w-0">
                  {selected.whenLabel && (
                    <p className="text-[11px] font-bold tracking-wide text-brand">
                      {selected.whenLabel}
                    </p>
                  )}
                  <h3 className="font-display text-lg font-semibold leading-tight truncate">
                    {selected.name}
                  </h3>
                  <p className="text-xs text-muted mt-0.5 truncate">
                    {[selected.typeLabel, selected.address ?? selected.city].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close preview"
                  className="shrink-0 w-9 h-9 -mr-1 -mt-1 rounded-xl inline-flex items-center justify-center text-muted hover:bg-line/60"
                >
                  ✕
                </button>
              </div>

              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {selected.vendorCount > 0 && (
                  <span className="text-xs text-ink-soft">
                    {selected.vendorCount} DropQ vendor{selected.vendorCount === 1 ? "" : "s"} attending
                  </span>
                )}
                {selected.preorderCount > 0 && (
                  <span className="text-xs font-semibold text-brand-dark">
                    {selected.preorderCount} taking preorders
                  </span>
                )}
              </div>

              <div className="p-3 pt-1">
                <Link
                  href={selected.href}
                  className="w-full inline-flex items-center justify-center min-h-[48px] rounded-xl bg-ink text-cream text-sm font-semibold"
                >
                  View DropMeet
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Mobile bottom sheet */}
        {!selected && (
          <div
            className={`lg:hidden absolute inset-x-0 bottom-0 z-20 bg-paper border-t border-line rounded-t-3xl shadow-[var(--shadow-lift)] flex flex-col transition-[height] duration-200 ${SHEET_CLASS[sheet]}`}
          >
            <button
              type="button"
              onClick={() => setSheet((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek"))}
              aria-label="Resize results panel"
              className="shrink-0 py-3 flex flex-col items-center gap-1.5"
            >
              <span className="w-10 h-1 rounded-full bg-line-strong" aria-hidden />
              <span className="text-xs font-semibold text-ink-soft">
                {counts.total} place{counts.total === 1 ? "" : "s"}
                {counts.preorder > 0 ? ` · ${counts.preorder} with preorders` : ""}
              </span>
            </button>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{list}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function SearchBox({
  query,
  setQuery,
  elevated,
}: {
  query: string;
  setQuery: (v: string) => void;
  elevated?: boolean;
}) {
  return (
    <input
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        if (e.target.value.length > 2) track("search_used", { surface: "dropmeet" });
      }}
      placeholder="Search markets, places, neighborhoods…"
      aria-label="Search DropMeet"
      className={`w-full min-h-[48px] rounded-xl px-4 text-[0.95rem] border transition focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 ${
        elevated
          ? "bg-paper border-line shadow-[var(--shadow-soft)]"
          : "bg-cream/60 border-line-strong"
      }`}
    />
  );
}

function FilterRow({
  filters,
  toggleFilter,
  elevated,
}: {
  filters: FilterKey[];
  toggleFilter: (k: FilterKey) => void;
  elevated?: boolean;
}) {
  return (
    <div className={`flex gap-2 overflow-x-auto pb-1 ${elevated ? "mt-2" : "mt-3"} -mx-1 px-1`}>
      {FILTERS.map((f) => {
        const on = filters.includes(f.key);
        return (
          <button
            key={f.key}
            type="button"
            onClick={() => toggleFilter(f.key)}
            aria-pressed={on}
            className={`shrink-0 min-h-[40px] px-3.5 rounded-pill text-sm font-medium whitespace-nowrap border transition ${
              on
                ? "bg-ink text-cream border-ink"
                : elevated
                  ? "bg-paper text-ink-soft border-line shadow-[var(--shadow-soft)]"
                  : "bg-paper text-ink-soft border-line-strong hover:border-ink/25"
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function Header({
  regionName,
  query,
  setQuery,
  filters,
  toggleFilter,
  counts,
  loading,
}: {
  regionName: string;
  query: string;
  setQuery: (v: string) => void;
  filters: FilterKey[];
  toggleFilter: (k: FilterKey) => void;
  counts: { total: number; preorder: number };
  loading: boolean;
}) {
  return (
    <div className="shrink-0 p-4 border-b border-line">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="font-display text-xl font-semibold">DropMeet</h1>
        <Link href="/dropmeet/add" className="text-xs font-semibold text-brand hover:underline">
          Add a place
        </Link>
      </div>
      <p className="text-sm text-muted mt-0.5">
        Discover local markets, vendors, drops, and gathering places in {regionName}.
      </p>
      <div className="mt-3">
        <SearchBox query={query} setQuery={setQuery} />
      </div>
      <FilterRow filters={filters} toggleFilter={toggleFilter} />
      <p className="text-xs text-muted mt-2" aria-live="polite">
        {loading
          ? "Searching…"
          : `${counts.total} place${counts.total === 1 ? "" : "s"}${
              counts.preorder > 0 ? ` · ${counts.preorder} with preorders` : ""
            }`}
      </p>
    </div>
  );
}
