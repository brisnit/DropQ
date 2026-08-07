"use client";

import { useCallback, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { MAX_BODY, messageStamp, type SenderType } from "@/lib/messaging-shared";
import type { SendState } from "@/lib/actions/messages";

export type ThreadMessage = {
  id: string;
  body: string;
  senderType: SenderType;
  messageType: string;
  createdAt: string; // ISO — Dates don't survive the server/client boundary
  readAt: string | null;
};

type Props = {
  conversationId: string;
  /** Which side of the conversation is looking. */
  viewer: "vendor" | "customer";
  initialMessages: ThreadMessage[];
  /** Server action bound by the parent page (vendor vs customer variant). */
  action: (prev: SendState, formData: FormData) => Promise<SendState>;
  /** Clears this side's unread counter once the thread is genuinely on screen. */
  markReadAction: (conversationId: string) => Promise<void>;
  placeholder?: string;
};

const POLL_MS = 6000;

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function MessageThread({
  conversationId,
  viewer,
  initialMessages,
  action,
  markReadAction,
  placeholder = "Write a message…",
}: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Optimistic echo so a send feels instant on a phone mid-drop.
  const [optimistic, addOptimistic] = useOptimistic(
    messages,
    (state: ThreadMessage[], pending: ThreadMessage) => [...state, pending]
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the newest message in view, but don't yank the vendor back down if
  // they've scrolled up to read history.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [optimistic.length]);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  // Reading happens when the thread is open in front of someone — not when
  // Next prefetches the route on link hover.
  useEffect(() => {
    markReadAction(conversationId).catch(() => {});
  }, [conversationId, markReadAction]);

  // ── Polling ──────────────────────────────────────────────────────────────
  const poll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const latest = messages[messages.length - 1]?.createdAt;
      const qs = new URLSearchParams({ conversationId, viewer });
      if (latest) qs.set("after", latest);
      const res = await fetch(`/api/messages/poll?${qs}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: ThreadMessage[] };
      if (!data.messages?.length) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = data.messages!.filter((m) => !seen.has(m.id));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    } catch {
      // Offline or a flaky network — the next tick retries.
    }
  }, [conversationId, messages, viewer]);

  useEffect(() => {
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  // ── Sending ──────────────────────────────────────────────────────────────
  const submit = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    if (body.length > MAX_BODY) {
      setError(`Keep it under ${MAX_BODY} characters.`);
      return;
    }

    setError(null);
    setDraft("");
    // Reset the grow-with-content textarea back to one row.
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const formData = new FormData();
    formData.set("conversationId", conversationId);
    formData.set("body", body);

    startTransition(async () => {
      addOptimistic({
        id: `pending-${Date.now()}`,
        body,
        senderType: viewer,
        messageType: "text",
        createdAt: new Date().toISOString(),
        readAt: null,
      });
      const res = await action({}, formData);
      if (res.error) {
        // Put the text back so nothing is lost on a failed send.
        setError(res.error);
        setDraft((d) => d || body);
        return;
      }
      // Swap the optimistic bubble for the real row immediately; without this
      // the message would vanish for one poll interval.
      if (res.message) {
        const real = res.message as ThreadMessage;
        setMessages((prev) => (prev.some((m) => m.id === real.id) ? prev : [...prev, real]));
      } else {
        await poll();
      }
    });
  }, [draft, conversationId, viewer, action, addOptimistic, poll]);

  let lastDay = "";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 space-y-1">
        {optimistic.length === 0 && (
          <p className="text-sm text-muted text-center py-10">
            No messages yet — say hello.
          </p>
        )}
        {optimistic.map((m) => {
          const mine = m.senderType === viewer;
          const system = m.senderType === "system";
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;

          return (
            <div key={m.id}>
              {showDay && (
                <div className="text-center py-3">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted bg-cream px-2.5 py-1 rounded-pill">
                    {day}
                  </span>
                </div>
              )}

              {system ? (
                <p className="text-center text-xs text-muted py-1.5">{m.body}</p>
              ) : (
                <div className={`flex ${mine ? "justify-end" : "justify-start"} py-0.5`}>
                  <div className={`max-w-[85%] sm:max-w-[70%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                    {m.messageType === "announcement" && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-brand mb-1">
                        Announcement
                      </span>
                    )}
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-[0.95rem] leading-snug whitespace-pre-wrap break-words ${
                        mine
                          ? "bg-ink text-cream rounded-br-md"
                          : m.messageType === "announcement"
                            ? "bg-brand-tint text-ink rounded-bl-md"
                            : "bg-paper border border-line text-ink rounded-bl-md"
                      }`}
                    >
                      {m.body}
                    </div>
                    <span className="text-[11px] text-muted mt-1 px-1">
                      {messageStamp(m.createdAt)}
                      {mine && m.readAt ? " · Read" : ""}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-line bg-paper px-3 sm:px-4 py-3 shrink-0">
        {error && (
          <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2 mb-2">{error}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              // Grow to fit, capped so the keyboard never eats the thread.
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. On touch keyboards Enter
              // should insert a newline instead, so only bind it with a mouse.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={placeholder}
            aria-label="Message"
            className="flex-1 resize-none bg-cream/60 border border-line-strong rounded-2xl px-3.5 py-3 text-[0.95rem] leading-snug focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition max-h-[140px]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send message"
            className="shrink-0 h-12 w-12 sm:w-auto sm:px-5 rounded-2xl bg-ink text-cream font-semibold text-sm inline-flex items-center justify-center transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
          >
            <span className="sm:hidden text-lg leading-none" aria-hidden>
              ↑
            </span>
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}
