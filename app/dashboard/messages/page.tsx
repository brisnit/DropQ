import { requireSeller } from "@/lib/auth";
import { vendorConversationRows } from "@/lib/messaging";
import { ConversationList } from "@/components/conversation-list";
import { EmptyState } from "@/components/dashboard-ui";

export const metadata = { title: "Messages — DropQ" };

export default async function VendorMessagesPage() {
  const seller = await requireSeller();
  const rows = await vendorConversationRows(seller.id);

  if (rows.length === 0) {
    return (
      <div className="p-5 sm:p-8 max-w-5xl">
        <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mb-7">
          Messages
        </h1>
        <EmptyState
          emoji="💬"
          title="No messages yet"
          body="When customers message you or you start a conversation, you'll see it here."
          ctaHref="/dashboard/customers"
          ctaLabel="View Customers"
        />
      </div>
    );
  }

  return (
    <div className="md:h-screen md:flex md:flex-col">
      {/* Mobile + desktop list. On desktop the split view lives in the
          [conversationId] route; here the list owns the full width. */}
      <div className="lg:grid lg:grid-cols-[360px_1fr] lg:h-full lg:min-h-0">
        <div className="border-r border-line bg-paper lg:h-full lg:min-h-0 lg:overflow-y-auto">
          <div className="px-4 py-4 border-b border-line sticky top-0 bg-paper z-10">
            <h1 className="font-display text-xl font-semibold">Messages</h1>
          </div>
          <ConversationList rows={rows} />
        </div>

        {/* Desktop-only placeholder until a thread is picked. */}
        <div className="hidden lg:flex items-center justify-center text-center p-10">
          <div>
            <div className="text-4xl">💬</div>
            <p className="text-muted mt-3 max-w-xs">
              Pick a conversation to read it and reply.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
