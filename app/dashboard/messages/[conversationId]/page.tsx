import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSeller } from "@/lib/auth";
import {
  vendorConversation,
  vendorConversationRows,
  threadMessages,
  customerContext,
  customerLabel,
} from "@/lib/messaging";
import { vendorSendMessageAction, vendorMarkReadAction } from "@/lib/actions/messages";
import { ConversationList } from "@/components/conversation-list";
import { MessageThread } from "@/components/message-thread";
import { CustomerContextPanel } from "@/components/customer-context-panel";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui";
import { statusStyle } from "@/lib/format";
import { orderStatusLabel } from "@/lib/orders";

export const metadata = { title: "Messages — DropQ" };

export default async function VendorConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const seller = await requireSeller();

  // Scoped lookup — another vendor's conversation id 404s here.
  const convo = await vendorConversation(seller.id, conversationId);
  if (!convo) notFound();

  // Mark-read is fired by MessageThread once it's actually on screen, so a
  // prefetch on hover can't quietly clear the badge.
  const [rows, messages, ctx] = await Promise.all([
    vendorConversationRows(seller.id),
    threadMessages(convo.id),
    customerContext(seller.id, convo.customerId),
  ]);

  const name = customerLabel(convo.customer);

  return (
    <div className="lg:grid lg:grid-cols-[360px_1fr] h-[calc(100dvh-3.5rem)] md:h-screen min-h-0">
      {/* Conversation list — desktop only once a thread is open */}
      <aside className="hidden lg:block border-r border-line bg-paper h-full min-h-0 overflow-y-auto">
        <div className="px-4 py-4 border-b border-line sticky top-0 bg-paper z-10">
          <h1 className="font-display text-xl font-semibold">Messages</h1>
        </div>
        <ConversationList rows={rows} activeId={convo.id} />
      </aside>

      {/* Thread */}
      <section className="flex flex-col h-full min-h-0 bg-cream">
        {/* Header — customer identity first, order/drop context underneath */}
        <header className="shrink-0 bg-paper border-b border-line px-4 sm:px-5 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/messages"
              className="lg:hidden -ml-1 w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl text-ink-soft hover:bg-line/60 transition"
              aria-label="Back to messages"
            >
              ←
            </Link>
            <Avatar name={name} seed={convo.customerId} />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-semibold truncate leading-tight">{name}</h2>
              <div className="flex items-center gap-2 flex-wrap mt-0.5">
                {convo.lastDrop && (
                  <Link
                    href={`/dashboard/drops/${convo.lastDrop.id}`}
                    className="text-xs text-brand hover:underline truncate"
                  >
                    {convo.lastDrop.title}
                  </Link>
                )}
                {convo.lastOrder && (
                  <Badge className={statusStyle(convo.lastOrder.status)}>
                    {orderStatusLabel(convo.lastOrder.status)}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 flex flex-col xl:flex-row">
          <div className="flex-1 min-h-0 flex flex-col">
            <MessageThread
              conversationId={convo.id}
              viewer="vendor"
              initialMessages={messages}
              action={vendorSendMessageAction}
              markReadAction={vendorMarkReadAction}
              placeholder={`Message ${name}…`}
            />
          </div>

          {/* Customer context — a right rail on wide screens, collapsible
              above the composer on narrow ones. */}
          {ctx && (
            <div className="shrink-0 xl:w-72 xl:border-l border-line xl:bg-cream p-3 xl:overflow-y-auto order-first xl:order-last">
              <CustomerContextPanel ctx={ctx} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
