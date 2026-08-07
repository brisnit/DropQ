import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { messageStamp } from "@/lib/messaging-shared";

export type ConversationRow = {
  id: string;
  href: string;
  /** Who the *other* party is — always a name, never an id. */
  name: string;
  imageUrl?: string | null;
  preview: string | null;
  lastMessageAt: Date | string;
  unread: number;
  /** e.g. "Saturday Sourdough · Ready for pickup" */
  context?: string | null;
};

/**
 * Shared inbox list. Used by both the vendor Messages panel and the customer
 * inbox so the two sides stay visually identical — same row height, same
 * unread treatment, same tap target.
 */
export function ConversationList({
  rows,
  activeId,
}: {
  rows: ConversationRow[];
  activeId?: string;
}) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const active = r.id === activeId;
        return (
          <li key={r.id}>
            <Link
              href={r.href}
              className={`flex items-start gap-3 px-4 py-3.5 min-h-[72px] transition ${
                active ? "bg-cream" : "hover:bg-cream/70"
              }`}
            >
              <Avatar name={r.name} imageUrl={r.imageUrl} seed={r.id} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`truncate ${r.unread > 0 ? "font-semibold text-ink" : "font-medium text-ink"}`}
                  >
                    {r.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted">
                    {messageStamp(r.lastMessageAt)}
                  </span>
                </div>
                <p
                  className={`text-sm truncate mt-0.5 ${
                    r.unread > 0 ? "text-ink-soft font-medium" : "text-muted"
                  }`}
                >
                  {r.preview ?? "No messages yet"}
                </p>
                {r.context && (
                  <p className="text-[11px] text-muted truncate mt-1">{r.context}</p>
                )}
              </div>
              {r.unread > 0 && (
                <span
                  className="shrink-0 self-center min-w-[22px] h-[22px] px-1.5 rounded-pill bg-brand text-white text-[11px] font-bold inline-flex items-center justify-center"
                  aria-label={`${r.unread} unread`}
                >
                  {r.unread > 99 ? "99+" : r.unread}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
