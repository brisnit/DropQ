"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { relativeTime } from "@/lib/format";

export type NotificationItem = {
  id: string;
  title: string;
  body: string | null;
  href: string;
  createdAt: string; // ISO
  read: boolean;
};

const POLL_MS = 20000;

/**
 * Notification centre for both vendors and customers. The badge count refreshes
 * on the shared polling endpoint; the list itself is passed in from the server
 * render and re-fetched when the panel opens, which keeps the common case (a
 * closed bell) down to one tiny request.
 */
export function NotificationBell({
  viewer,
  initialItems,
  initialUnread,
  markAllAction,
}: {
  viewer: "vendor" | "customer";
  initialItems: NotificationItem[];
  initialUnread: number;
  markAllAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState(initialItems);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Badge polling — visible tabs only.
  useEffect(() => {
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/messages/poll?viewer=${viewer}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { notifications?: number };
        if (typeof data.notifications === "number") setUnread(data.notifications);
      } catch {
        /* next tick retries */
      }
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [viewer]);

  useEffect(() => setItems(initialItems), [initialItems]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative w-11 h-11 rounded-xl inline-flex items-center justify-center text-ink hover:bg-line/60 transition"
      >
        {/* Outline bell, stroked in currentColor — an emoji rendered gold and
            sat outside the design system's palette. */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-pill bg-brand text-white text-[10px] font-bold inline-flex items-center justify-center border-2 border-cream">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[calc(100vw_-_2.5rem)] max-w-sm bg-paper border border-line rounded-card shadow-[var(--shadow-lift)] z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="font-display font-semibold">Notifications</span>
            {unread > 0 && (
              <form
                action={async (fd) => {
                  setUnread(0);
                  setItems((prev) => prev.map((i) => ({ ...i, read: true })));
                  await markAllAction(fd);
                }}
              >
                <input type="hidden" name="viewer" value={viewer} />
                <button className="text-xs font-medium text-brand hover:underline">
                  Mark all as read
                </button>
              </form>
            )}
          </div>

          {items.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted text-center">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-[min(60vh,26rem)] overflow-y-auto divide-y divide-line">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => setOpen(false)}
                    className={`block px-4 py-3 hover:bg-cream transition ${
                      n.read ? "" : "bg-brand-tint/25"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read && (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-brand shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <p className={`text-sm truncate ${n.read ? "text-ink-soft" : "font-semibold text-ink"}`}>
                          {n.title}
                        </p>
                        {n.body && <p className="text-xs text-muted truncate mt-0.5">{n.body}</p>}
                        <p className="text-[11px] text-muted mt-1">{relativeTime(n.createdAt)}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
