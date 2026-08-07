import { requireCustomer } from "@/lib/customer-auth";
import { customerConversationRows } from "@/lib/messaging";
import { ConversationList } from "@/components/conversation-list";

export const metadata = { title: "Messages — DropQ" };

export default async function CustomerInboxPage() {
  const customer = await requireCustomer("/messages");
  const rows = await customerConversationRows(customer.id);

  return (
    <main className="flex-1 min-h-0">
      <div className="px-4 sm:px-5 py-4 border-b border-line bg-paper">
        <h1 className="font-display text-xl font-semibold">Messages</h1>
        <p className="text-sm text-muted mt-0.5">
          Conversations with the businesses you order from.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="p-5 sm:p-8 max-w-md mx-auto">
          <div className="bg-paper border border-dashed border-line-strong rounded-card p-10 text-center">
            <div className="text-5xl">💬</div>
            <h2 className="font-display text-xl font-semibold mt-4">No messages yet</h2>
            <p className="text-muted mt-2">
              Messages from businesses you purchase from will appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-paper">
          <ConversationList rows={rows} />
        </div>
      )}
    </main>
  );
}
