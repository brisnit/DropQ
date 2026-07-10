"use client";

import Link from "next/link";
import { useState } from "react";
import type { DiscoveryItem } from "@/lib/discover";
import { vendorPalette } from "@/lib/color";
import { googleCalendarUrl, icsContent, type CalEvent } from "@/lib/calendar";
import { isSaved, saveItem, removeSaved } from "@/lib/saved-store";
import { track } from "@/lib/analytics";

const STATUS_STYLES: Record<string, string> = {
  open: "bg-sage text-white",
  closing_soon: "bg-brand text-white",
  today: "bg-tertiary text-white",
  weekend: "bg-quad/90 text-white",
  upcoming: "bg-ink text-cream",
  vendor: "bg-line text-ink-soft",
};

function absUrl(path: string): string {
  return path.startsWith("http") ? path : `https://www.drop-q.com${path}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function DiscoveryCard({ item }: { item: DiscoveryItem }) {
  const [saved, setSaved] = useState(() => isSaved(item.id));
  const [calOpen, setCalOpen] = useState(false);
  const cta = vendorPalette(item.accent).vendor_cta_color;

  const locationParts = [item.cityLabel, item.state].filter(Boolean).join(", ");
  const distance = item.distanceMiles != null ? `${item.distanceMiles} mi` : null;

  const toggleSave = () => {
    if (saved) {
      removeSaved(item.id);
      setSaved(false);
      track("saved_item_removed", { id: item.id, kind: item.kind });
    } else {
      saveItem(item, Date.now());
      setSaved(true);
      track("item_saved", { id: item.id, kind: item.kind });
    }
  };

  const calEvent = (): CalEvent | null => {
    if (!item.eventStart) return null;
    return {
      title: item.title || `${item.vendorName} drop`,
      vendorName: item.vendorName,
      start: item.eventStart,
      end: item.eventEnd,
      orderCloseAt: item.orderCloseAt,
      locationLabel: [item.publicLocationName, locationParts].filter(Boolean).join(" · ") || null,
      url: absUrl(item.href),
      notes: null,
    };
  };
  const ev = calEvent();

  const downloadIcs = () => {
    if (!ev) return;
    const blob = new Blob([icsContent(ev)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.vendorName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-drop.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    track("calendar_event_created", { id: item.id, type: "ics" });
    setCalOpen(false);
  };

  return (
    <div className="bg-paper border border-line rounded-card overflow-hidden shadow-[var(--shadow-soft)] flex flex-col">
      {/* Media + overlays */}
      <div className="relative h-32 sm:h-36" style={{ backgroundColor: item.accent }}>
        {item.headerImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.headerImage} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : item.vendorLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.vendorLogo} alt="" className="absolute inset-0 w-full h-full object-cover opacity-90" />
        ) : null}
        <span
          className={`absolute top-2.5 left-2.5 text-[11px] font-semibold uppercase tracking-wide px-2 py-1 rounded-pill ${STATUS_STYLES[item.status] ?? "bg-ink text-cream"}`}
        >
          {item.statusLabel}
        </span>
        <button
          type="button"
          onClick={toggleSave}
          aria-label={saved ? "Remove from saved" : "Save on this device"}
          aria-pressed={saved}
          className="absolute top-2 right-2 w-9 h-9 grid place-items-center rounded-full bg-white/90 hover:bg-white text-ink shadow-sm transition"
        >
          <span className="text-lg leading-none">{saved ? "🔖" : "🏷️"}</span>
        </button>
      </div>

      {/* Body */}
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {item.vendorLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.vendorLogo} alt="" className="w-6 h-6 rounded object-cover border border-line shrink-0" />
          )}
          <span className="text-sm font-medium text-ink-soft truncate">{item.vendorName}</span>
        </div>

        <h3 className="font-display text-lg font-semibold leading-tight">
          {item.title || `Shop ${item.vendorName}`}
        </h3>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{item.categoryLabel}</span>
          {locationParts && <><span aria-hidden>·</span><span>{locationParts}</span></>}
          {distance && <><span aria-hidden>·</span><span>{distance}</span></>}
        </div>

        {item.eventStart && (
          <p className="text-sm text-ink-soft">📅 {fmtDate(item.eventStart)}</p>
        )}
        {item.orderCloseAt && item.status !== "vendor" && (
          <p className="text-xs text-muted">Order by {fmtDate(item.orderCloseAt)}</p>
        )}
        {item.fulfillment && (
          <span className="inline-flex w-fit text-[11px] font-medium text-ink-soft bg-cream border border-line rounded-pill px-2 py-0.5">
            {item.fulfillment === "delivery" ? "🚗 Local delivery" : item.fulfillment === "handoff" ? "🤝 On-site" : "🥡 Pickup"}
          </span>
        )}

        {/* Actions */}
        <div className="mt-auto pt-2 flex items-center gap-2">
          <Link
            href={item.href}
            onClick={() => track("discovery_card_opened", { id: item.id, kind: item.kind, href: item.href })}
            className="flex-1 text-center text-sm font-semibold rounded-xl py-2.5 text-white transition"
            style={{ backgroundColor: cta }}
          >
            {item.kind === "vendor" ? "View store" : "View Drop"}
          </Link>
          {ev && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setCalOpen((o) => !o)}
                aria-label="Add to calendar"
                className="w-10 h-10 grid place-items-center rounded-xl border border-line-strong bg-paper hover:border-ink/30 transition"
              >
                📆
              </button>
              {calOpen && (
                <div className="absolute right-0 bottom-full mb-2 z-20 w-48 bg-paper border border-line rounded-xl shadow-[var(--shadow-lift)] p-1.5 text-sm">
                  <a
                    href={googleCalendarUrl(ev)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => { track("calendar_event_created", { id: item.id, type: "google" }); setCalOpen(false); }}
                    className="block px-3 py-2 rounded-lg hover:bg-line/60"
                  >
                    Google Calendar
                  </a>
                  <button type="button" onClick={downloadIcs} className="w-full text-left px-3 py-2 rounded-lg hover:bg-line/60">
                    Apple / Outlook (.ics)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
