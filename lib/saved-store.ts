// "Save on this device" store — localStorage only, no account, no cross-device
// sync. Holds a snapshot of each saved discovery item so the Saved view still
// renders if the source drop later changes/expires.
import type { DiscoveryItem } from "@/lib/discover";

export type SavedItem = DiscoveryItem & { savedAt: number };

const KEY = "dropq_saved_drops";

export function getSaved(): SavedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as SavedItem[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isSaved(id: string): boolean {
  return getSaved().some((s) => s.id === id);
}

function write(items: SavedItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200)));
  } catch {
    /* storage full/disabled — ignore */
  }
}

/** Save an item (no-op if already saved). `savedAt` uses a caller-supplied ts. */
export function saveItem(item: DiscoveryItem, savedAt: number): SavedItem[] {
  const all = getSaved();
  if (all.some((s) => s.id === item.id)) return all;
  const next = [{ ...item, savedAt }, ...all];
  write(next);
  return next;
}

export function removeSaved(id: string): SavedItem[] {
  const next = getSaved().filter((s) => s.id !== id);
  write(next);
  return next;
}
