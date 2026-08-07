"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { DropMeetItem } from "@/lib/dropmeet/types";

/**
 * The DropMeet map.
 *
 * Region containment is enforced three ways, deliberately overlapping:
 *   1. `maxBounds` stops the viewport leaving the county at all.
 *   2. A mask polygon greys out everything outside the county line, so the
 *      edge of the product is visible rather than implied.
 *   3. The server clamps every bounds query anyway — the map is a convenience,
 *      never the security boundary.
 *
 * Renders nothing but a graceful placeholder when no token is configured, so
 * the rest of DropMeet works before Mapbox is set up.
 */

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function mapboxConfigured(): boolean {
  return !!TOKEN;
}

type RegionPayload = {
  name: string;
  center: { lat: number; lng: number };
  zoom: number;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  geometry: { type: "Polygon"; coordinates: number[][][] } | null;
};

type Props = {
  items: DropMeetItem[];
  selectedId?: string | null;
  onSelect?: (item: DropMeetItem | null) => void;
  onBoundsChange?: (b: { minLat: number; minLng: number; maxLat: number; maxLng: number }) => void;
  className?: string;
};

const SRC = "dropmeet";

/**
 * Mapbox v3 types `GeoJSONFeature` opaquely, so query results don't expose
 * `properties`/`geometry` to TypeScript. We know the shape — we authored the
 * source — so narrow it locally rather than sprinkling `any`.
 */
type ClickedFeature = {
  properties?: Record<string, unknown> | null;
  geometry?: { type: string; coordinates: number[] };
};

function asFeature(f: unknown): ClickedFeature | null {
  return (f as ClickedFeature) ?? null;
}

function toFeatureCollection(items: DropMeetItem[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.map((i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [i.longitude, i.latitude] },
      properties: {
        id: i.id,
        name: i.name,
        kind: i.kind,
        preorder: i.preorderCount > 0 ? 1 : 0,
        vendors: i.vendorCount,
      },
    })),
  };
}

export function DropMeetMap({ items, selectedId, onSelect, onBoundsChange, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBoundsRef = useRef(onBoundsChange);
  const onSelectRef = useRef(onSelect);
  const itemsRef = useRef(items);

  useEffect(() => {
    onBoundsRef.current = onBoundsChange;
    onSelectRef.current = onSelect;
    itemsRef.current = items;
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      let region: RegionPayload | null = null;
      try {
        const res = await fetch("/api/dropmeet/region");
        if (res.ok) region = await res.json();
      } catch {
        /* fall through to defaults */
      }
      if (cancelled || !containerRef.current) return;

      mapboxgl.accessToken = TOKEN;

      const bbox = region?.bbox;
      // A little padding so the county edge isn't flush against the frame.
      const maxBounds: mapboxgl.LngLatBoundsLike | undefined = bbox
        ? [
            [bbox.minLng - 0.35, bbox.minLat - 0.35],
            [bbox.maxLng + 0.35, bbox.maxLat + 0.35],
          ]
        : undefined;

      let map: mapboxgl.Map;
      try {
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/light-v11",
          center: [region?.center.lng ?? -117.1611, region?.center.lat ?? 32.7157],
          zoom: region?.zoom ?? 9.2,
          minZoom: 8,
          maxZoom: 17,
          maxBounds,
          attributionControl: true,
          cooperativeGestures: true, // don't hijack page scroll on mobile
        });
      } catch (e) {
        console.error("Mapbox failed to initialise:", e);
        setFailure(e instanceof Error ? e.message : "The map failed to start.");
        return;
      }

      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(
        new mapboxgl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
        "top-right"
      );

      /**
       * Mapbox reports a bad token asynchronously — the constructor succeeds and
       * the 401 arrives here when the style request fails. Without surfacing it
       * the user just gets a blank canvas, so fatal errors are promoted to the
       * fallback panel. Transient tile errors are logged and ignored.
       */
      map.on("error", (e) => {
        const err = e?.error as (Error & { status?: number }) | undefined;
        console.error("Mapbox error:", err ?? e);

        const status = err?.status;
        const message = err?.message ?? "";
        if (status === 401 || status === 403) {
          setFailure(
            "Mapbox rejected the token (HTTP " +
              status +
              "). Check NEXT_PUBLIC_MAPBOX_TOKEN is a public 'pk.' token and that this domain is allowed in its URL restrictions."
          );
        } else if (/style/i.test(message) && /load|fetch|not found/i.test(message)) {
          setFailure("The map style failed to load. " + message);
        }
      });

      // A zero-height container at init leaves Mapbox with a 0x0 canvas that
      // never repaints — likely here because we await the region fetch first.
      const ro = new ResizeObserver(() => map.resize());
      ro.observe(containerRef.current);
      resizeObserverRef.current = ro;

      /**
       * Watchdog. Some failures (a worker that won't start, a network block)
       * neither throw nor emit an 'error' event — the map just never loads and
       * the user stares at an empty box. If 'load' hasn't fired in 12s, report
       * what we can actually measure so the problem is diagnosable from the
       * page instead of only from the console.
       */
      watchdogRef.current = setTimeout(() => {
        if (cancelled || map.loaded()) return;
        const el = containerRef.current;
        const w = el?.clientWidth ?? 0;
        const h = el?.clientHeight ?? 0;
        setFailure(
          h === 0 || w === 0
            ? `The map container has no size (${w}×${h}px), so there was nothing to draw into.`
            : `The map didn't finish loading within 12s (container ${w}×${h}px). Check the browser console — a blocked worker or network request is the usual cause.`
        );
      }, 12_000);

      map.on("load", () => {
        if (cancelled) return;

        // Mask everything outside the county: a world-sized ring with the
        // county polygon punched out as a hole.
        if (region?.geometry) {
          map.addSource("region-mask", {
            type: "geojson",
            data: {
              type: "Feature",
              properties: {},
              geometry: {
                type: "Polygon",
                coordinates: [
                  [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
                  ...region.geometry.coordinates,
                ],
              },
            },
          });
          map.addLayer({
            id: "region-mask",
            type: "fill",
            source: "region-mask",
            paint: { "fill-color": "#fafafa", "fill-opacity": 0.82 },
          });

          map.addSource("region-line", {
            type: "geojson",
            data: { type: "Feature", properties: {}, geometry: region.geometry },
          });
          map.addLayer({
            id: "region-line",
            type: "line",
            source: "region-line",
            paint: { "line-color": "#ff6268", "line-width": 1.5, "line-opacity": 0.5 },
          });
        }

        map.addSource(SRC, {
          type: "geojson",
          data: toFeatureCollection(itemsRef.current),
          cluster: true,
          clusterRadius: 48,
          clusterMaxZoom: 13,
        });

        map.addLayer({
          id: "clusters",
          type: "circle",
          source: SRC,
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#1a1a1a",
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 30, 30],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: SRC,
          filter: ["has", "point_count"],
          layout: {
            "text-field": ["get", "point_count_abbreviated"],
            "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
            "text-size": 13,
          },
          paint: { "text-color": "#ffffff" },
        });

        // Unclustered pins: coral when something is preorderable, ink otherwise.
        map.addLayer({
          id: "pins",
          type: "circle",
          source: SRC,
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": ["case", ["==", ["get", "preorder"], 1], "#ff6268", "#1a1a1a"],
            "circle-radius": ["case", ["==", ["get", "preorder"], 1], 10, 8],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#ffffff",
          },
        });

        map.addLayer({
          id: "pins-selected",
          type: "circle",
          source: SRC,
          filter: ["==", ["get", "id"], ""],
          paint: {
            "circle-color": "#ff6268",
            "circle-radius": 14,
            "circle-stroke-width": 4,
            "circle-stroke-color": "#1a1a1a",
          },
        });

        const pointer = (on: boolean) => {
          map.getCanvas().style.cursor = on ? "pointer" : "";
        };
        for (const layer of ["pins", "clusters"]) {
          map.on("mouseenter", layer, () => pointer(true));
          map.on("mouseleave", layer, () => pointer(false));
        }

        map.on("click", "pins", (e) => {
          const id = asFeature(e.features?.[0])?.properties?.id as string | undefined;
          const item = itemsRef.current.find((i) => i.id === id) ?? null;
          onSelectRef.current?.(item);
        });

        // Tapping a cluster zooms to the level where it splits apart.
        // getClusterExpansionZoom is callback-based even in v3's own types.
        map.on("click", "clusters", (e) => {
          const feature = asFeature(e.features?.[0]);
          const clusterId = feature?.properties?.cluster_id;
          const coords = feature?.geometry?.coordinates;
          if (clusterId == null || !coords) return;
          const src = map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined;
          if (!src) return;
          src.getClusterExpansionZoom(clusterId as number, (err, zoom) => {
            if (err || zoom == null) return;
            map.easeTo({ center: [coords[0], coords[1]], zoom });
          });
        });

        // Tapping empty map closes the preview rather than trapping the user.
        map.on("click", (e) => {
          const hits = map.queryRenderedFeatures(e.point, { layers: ["pins", "clusters"] });
          if (hits.length === 0) onSelectRef.current?.(null);
        });

        const emit = () => {
          const b = map.getBounds();
          if (!b) return;
          onBoundsRef.current?.({
            minLat: b.getSouth(),
            minLng: b.getWest(),
            maxLat: b.getNorth(),
            maxLng: b.getEast(),
          });
        };
        map.on("moveend", emit);
        // Re-measure now the style is up, in case layout settled after init.
        map.resize();
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
        setReady(true);
      });
    })();

    return () => {
      cancelled = true;
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Data updates ─────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined;
    src?.setData(toFeatureCollection(items));
  }, [items, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("pins-selected")) return;
    map.setFilter("pins-selected", ["==", ["get", "id"], selectedId ?? ""]);

    if (selectedId) {
      const item = items.find((i) => i.id === selectedId);
      if (item) map.easeTo({ center: [item.longitude, item.latitude], duration: 400 });
    }
  }, [selectedId, items, ready]);

  // ── No token / failure fallback ──────────────────────────────────────────
  if (!TOKEN || failure) {
    return (
      <div
        className={`relative bg-cream border border-line flex items-center justify-center ${className ?? ""}`}
      >
        <div className="text-center p-6 max-w-xs">
          <div className="text-3xl">🗺️</div>
          <p className="font-display font-semibold mt-2">
            {failure ? "Map unavailable" : "Map not configured"}
          </p>
          <p className="text-sm text-muted mt-1 break-words">
            {failure ??
              "Add NEXT_PUBLIC_MAPBOX_TOKEN to switch the map on. Everything else works without it."}
          </p>
          {failure && (
            <p className="text-xs text-muted mt-2">Everything else on this page still works.</p>
          )}
        </div>
      </div>
    );
  }

  return <div ref={containerRef} className={className} aria-label="Map of DropMeet places" />;
}
