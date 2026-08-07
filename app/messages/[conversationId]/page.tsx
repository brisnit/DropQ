import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/lib/customer-auth";
import { customerConversation, threadMessages } from "@/lib/messaging";
import { customerSendMessageAction, customerMarkReadAction } from "@/lib/actions/messages";
import { MessageThread } from "@/components/message-thread";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui";
import { statusStyle } from "@/lib/format";
import { orderStatusLabel } from "@/lib/orders";

export const metadata = { title: "Messages — DropQ" };

export default async function CustomerConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const customer = await requireCustomer(`/messages/${conversationId}`);

  // Scoped lookup — a conversation they aren't part of 404s.
  const convo = await customerConversation(customer.id, conversationId);
  if (!convo) notFound();

  // Mark-read is fired by MessageThread on screen, not during render.
  const messages = await threadMessages(convo.id);

  return (
    <main className="flex-1 min-h-0 flex flex-col">
      {/* Header — which vendor, and what order/drop this is about */}
      <header className="shrink-0 bg-paper border-b border-line px-4 sm:px-5 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/messages"
            className="-ml-1 w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl text-ink-soft hover:bg-line/60 transition"
            aria-label="Back to messages"
          >
            ←
          </Link>
          <Avatar name={convo.seller.storeName} imageUrl={convo.seller.logoUrl} seed={convo.sellerId} />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold truncate leading-tight">
              {convo.seller.storeName}
            </h1>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              {convo.lastDrop && (
                <span className="text-xs text-muted truncate">{convo.lastDrop.title}</span>
              )}
              {convo.lastOrder && (
                <>
                  <Badge className={statusStyle(convo.lastOrder.status)}>
                    {orderStatusLabel(convo.lastOrder.status)}
                  </Badge>
                  <Link
                    href={`/order/${convo.lastOrder.id}`}
                    className="text-xs text-brand hover:underline"
                  >
                    View order
                  </Link>
                </>
              )}
            </div>
          </div>
          <Link
            href={`/s/${convo.seller.slug}`}
            className="hidden sm:inline-flex items-center min-h-[38px] px-3 rounded-pill border border-line-strong text-sm font-medium text-ink-soft hover:border-ink/30 transition shrink-0"
          >
            Visit store
          </Link>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <MessageThread
          conversationId={convo.id}
          viewer="customer"
          initialMessages={messages}
          action={customerSendMessageAction}
          markReadAction={customerMarkReadAction}
          placeholder={`Message ${convo.seller.storeName}…`}
        />
      </div>
    </main>
  );
}
