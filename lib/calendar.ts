// Add-to-calendar helpers for discovery drops/events. Pure module (client-safe).
//
// IMPORTANT: only PUBLIC location data (city / friendly location name) is ever
// placed in calendar output. Exact pickup addresses are never included here —
// those are only revealed to a customer after they've placed an order, on the
// order screen.

export type CalEvent = {
  title: string;
  vendorName: string;
  start: string; // ISO
  end?: string | null; // ISO
  orderCloseAt?: string | null; // ISO — shown as a note, not a time block
  locationLabel?: string | null; // public: city / neighborhood / venue name
  url: string; // absolute storefront/drop URL
  notes?: string | null; // public event notes
};

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

/** ISO → "YYYYMMDDTHHMMSSZ" (UTC basic format). */
function toStamp(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function endOrDefault(e: CalEvent): string {
  if (e.end) return e.end;
  return new Date(new Date(e.start).getTime() + DEFAULT_DURATION_MS).toISOString();
}

function descriptionLines(e: CalEvent): string[] {
  const lines = [`${e.vendorName} on DropQ`];
  if (e.orderCloseAt) {
    lines.push(`Order by: ${new Date(e.orderCloseAt).toLocaleString()}`);
  }
  if (e.notes) lines.push(e.notes);
  lines.push(e.url);
  return lines;
}

/** Google Calendar "add event" URL. */
export function googleCalendarUrl(e: CalEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${e.title} — ${e.vendorName}`,
    dates: `${toStamp(e.start)}/${toStamp(endOrDefault(e))}`,
    details: descriptionLines(e).join("\n"),
  });
  if (e.locationLabel) params.set("location", e.locationLabel);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Escape per RFC 5545 (commas, semicolons, backslashes, newlines).
function esc(s: string): string {
  return s.replace(/([\\,;])/g, "\\$1").replace(/\r?\n/g, "\\n");
}

/** RFC-5545 .ics content for Apple Calendar / Outlook. */
export function icsContent(e: CalEvent): string {
  const uid = `${toStamp(e.start)}-${Math.abs(hashCode(e.url))}@drop-q.com`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DropQ//Vendor Finder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toStamp(new Date().toISOString())}`,
    `DTSTART:${toStamp(e.start)}`,
    `DTEND:${toStamp(endOrDefault(e))}`,
    `SUMMARY:${esc(`${e.title} — ${e.vendorName}`)}`,
    `DESCRIPTION:${esc(descriptionLines(e).join("\n"))}`,
    e.locationLabel ? `LOCATION:${esc(e.locationLabel)}` : "",
    `URL:${esc(e.url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n");
}

// Small deterministic hash for a stable UID (no Date.now / random needed).
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
