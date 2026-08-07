import Link from "next/link";
import { BroadcastComposer, type BroadcastCustomer } from "@/components/broadcast-composer";
import { sendBroadcastAction } from "@/lib/actions/messages";
import { Avatar } from "@/components/avatar";
import { messageStamp, type Audience } from "@/lib/messaging-shared";

export type DropCommunication = {
  counts: Record<Audience, number>;
  customers: BroadcastCustomer[];
  unreadReplies: number;
  recent: {
    id: string;
    name: string;
    preview: string;
    lastMessageAt: Date | string;
    fromCustomer: boolean;
    unread: number;
  }[];
};

/**
 * Customer Communication panel on the drop dashboard. Two primary actions plus
 * just enough signal (unread replies, the last few messages) to tell the vendor
 * whether anyone needs them — without turning into a second inbox.
 */
export function DropCommunicationSection({
  dropId,
  data,
}: {
  dropId: string;
  data: DropCommunication;
}) {
  const { counts, customers, unreadReplies, recent } = data;

  return (
    <section className="bg-paper border border-line rounded-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold">Customer Communication</h2>
          <p className="text-xs text-muted mt-0.5">
            {counts.drop_all} customer{counts.drop_all === 1 ? "" : "s"} in this drop
          </p>
        </div>
        {unreadReplies > 0 && (
          <Link
            href="/dashboard/messages"
            className="inline-flex items-center gap-2 min-h-[38px] px-3.5 rounded-pill bg-brand-tint text-brand-dark text-sm font-semibold hover:bg-brand-tint/80 transition"
          >
            <span className="w-2 h-2 rounded-full bg-brand" aria-hidden />
            {unreadReplies} unread repl{unreadReplies === 1 ? "y" : "ies"}
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <Link
          href="/dashboard/messages"
          className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-pill border border-line-strong bg-paper text-sm font-semibold text-ink hover:border-ink/30 transition"
        >
          <span aria-hidden>💬</span> Message Customers
        </Link>
        <BroadcastComposer
          dropId={dropId}
          counts={counts}
          customers={customers}
          action={sendBroadcastAction}
        />
      </div>

      {recent.length > 0 && (
        <div className="border-t border-line pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Recent messages
          </p>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/dashboard/messages/${r.id}`}
                  className="flex items-center gap-3 py-2 px-2 -mx-2 rounded-xl hover:bg-cream transition min-h-[52px]"
                >
                  <Avatar name={r.name} size="sm" seed={r.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={`text-sm truncate ${r.unread > 0 ? "font-semibold" : "font-medium"}`}>
                        {r.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted">
                        {messageStamp(r.lastMessageAt)}
                      </span>
                    </span>
                    <span className="block text-xs text-muted truncate mt-0.5">
                      {r.fromCustomer ? "" : "You: "}
                      {r.preview}
                    </span>
                  </span>
                  {r.unread > 0 && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-brand" aria-hidden />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
