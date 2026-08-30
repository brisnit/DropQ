import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { upsertCustomer, createMagicLinkToken, consumeMagicLinkToken } from "@/lib/customer-auth";
import { linkOAuthCustomer } from "@/lib/customer-oauth";
import {
  getOrCreateConversation,
  customerForOrder,
  sendMessage,
  sendBroadcast,
  markConversationRead,
  vendorConversation,
  customerConversation,
  vendorConversationRows,
  customerConversationRows,
  vendorUnreadTotal,
  customerUnreadTotal,
  customerContext,
  dropCommunicationSummary,
  threadMessages,
  MAX_BODY,
} from "@/lib/messaging";
import { unreadNotificationCount, markAllNotificationsRead } from "@/lib/notification-center";

/**
 * Development-only self-test for the messaging layer. Exercises the real
 * library code — conversations, permissions, broadcast fan-out, unread
 * accounting — against a scratch database, then deletes everything it made.
 *
 * Hard 404 outside development. Never reachable in production.
 */

type Result = { name: string; pass: boolean; detail?: string };

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const results: Result[] = [];
  const check = (name: string, pass: boolean, detail?: string) => {
    results.push({ name, pass, detail });
  };

  const stamp = `selftest-${Date.now()}`;
  const madeSellerIds: string[] = [];
  const madeCustomerIds: string[] = [];

  try {
    // ── Fixtures: two independent vendors, three buyers ─────────────────────
    const vendorA = await prisma.seller.create({
      data: {
        email: `${stamp}-a@example.test`,
        passwordHash: "x",
        storeName: "The Clovery",
        slug: `${stamp}-a`,
      },
    });
    const vendorB = await prisma.seller.create({
      data: {
        email: `${stamp}-b@example.test`,
        passwordHash: "x",
        storeName: "Rival Bakery",
        slug: `${stamp}-b`,
      },
    });
    madeSellerIds.push(vendorA.id, vendorB.id);

    const dropA = await prisma.drop.create({
      data: { sellerId: vendorA.id, title: "Saturday Sourdough", status: "live" },
    });

    const buyers = [
      { name: "Sarah Martinez", email: `${stamp}-sarah@example.test`, phone: "+15551230001" },
      { name: "Dev Patel", email: `${stamp}-dev@example.test`, phone: null },
      { name: "Ana Ruiz", email: `${stamp}-ana@example.test`, phone: null },
    ];

    const orders = [];
    for (const [i, b] of buyers.entries()) {
      const c = await upsertCustomer(b);
      madeCustomerIds.push(c!.id);
      orders.push(
        await prisma.order.create({
          data: {
            dropId: dropA.id,
            sellerId: vendorA.id,
            buyerName: b.name,
            buyerEmail: b.email,
            buyerPhone: b.phone,
            customerId: c!.id,
            totalCents: 2400,
            // ready / new / new — so audience filters have something to bite on
            status: i === 0 ? "ready" : "new",
          },
        })
      );
    }

    const sarah = await prisma.customer.findUnique({ where: { email: buyers[0].email } });
    const dev = await prisma.customer.findUnique({ where: { email: buyers[1].email } });

    // ── 1. Vendor opens a conversation from an order ────────────────────────
    const found = await customerForOrder(orders[0].id, vendorA.id);
    check("customerForOrder resolves buyer identity", found?.customer.id === sarah!.id);

    const convo = await getOrCreateConversation(vendorA.id, sarah!.id, {
      dropId: dropA.id,
      orderId: orders[0].id,
    });
    check("conversation carries drop + order context", convo.lastDropId === dropA.id && convo.lastOrderId === orders[0].id);

    // ── 2. One conversation per vendor/customer pair, reused across drops ───
    const drop2 = await prisma.drop.create({
      data: { sellerId: vendorA.id, title: "Second Drop", status: "live" },
    });
    const again = await getOrCreateConversation(vendorA.id, sarah!.id, { dropId: drop2.id });
    check("second drop reuses the same conversation", again.id === convo.id);
    check("context pointer moved to the newer drop", again.lastDropId === drop2.id);

    // ── 3. Vendor sends; customer's unread + notification rise ──────────────
    await sendMessage({
      conversationId: convo.id,
      senderType: "vendor",
      senderSellerId: vendorA.id,
      body: "Your sourdough is ready for pickup!",
      dropId: dropA.id,
      orderId: orders[0].id,
    });
    let c1 = await prisma.conversation.findUnique({ where: { id: convo.id } });
    check("customer unread incremented", c1!.customerUnread === 1, `got ${c1!.customerUnread}`);
    check("vendor unread untouched by own message", c1!.vendorUnread === 0);
    check("conversation preview denormalized", !!c1!.lastMessagePreview);
    check(
      "customer notification raised",
      (await unreadNotificationCount({ kind: "customer", customerId: sarah!.id })) === 1
    );

    // ── 4. Customer replies; vendor's unread + notification rise ────────────
    await sendMessage({
      conversationId: convo.id,
      senderType: "customer",
      senderCustomerId: sarah!.id,
      body: "On my way, thank you!",
    });
    c1 = await prisma.conversation.findUnique({ where: { id: convo.id } });
    check("vendor unread incremented on reply", c1!.vendorUnread === 1, `got ${c1!.vendorUnread}`);
    check(
      "vendor notification raised",
      (await unreadNotificationCount({ kind: "vendor", sellerId: vendorA.id })) === 1
    );

    // ── 5. Mark read clears only the reader's side ──────────────────────────
    await markConversationRead(convo.id, "vendor", vendorA.id);
    c1 = await prisma.conversation.findUnique({ where: { id: convo.id } });
    check("vendor unread cleared", c1!.vendorUnread === 0);
    check("customer unread preserved", c1!.customerUnread === 1, `got ${c1!.customerUnread}`);
    check(
      "vendor notifications marked read",
      (await unreadNotificationCount({ kind: "vendor", sellerId: vendorA.id })) === 0
    );

    // ── 6. Cross-tenant isolation ──────────────────────────────────────────
    check("vendor B cannot read vendor A's conversation", (await vendorConversation(vendorB.id, convo.id)) === null);
    check("other customer cannot read this conversation", (await customerConversation(dev!.id, convo.id)) === null);
    check("owner can read their own conversation", (await vendorConversation(vendorA.id, convo.id)) !== null);
    check("customer can read their own conversation", (await customerConversation(sarah!.id, convo.id)) !== null);

    const bRows = await vendorConversationRows(vendorB.id);
    check("vendor B's inbox is empty", bRows.length === 0, `got ${bRows.length}`);

    // markConversationRead must refuse a conversation that isn't yours
    const stolen = await markConversationRead(convo.id, "vendor", vendorB.id);
    check("vendor B cannot mark vendor A's conversation read", stolen === false);

    // ── 7. Broadcast: private fan-out, not a group thread ───────────────────
    const bc = await sendBroadcast({
      sellerId: vendorA.id,
      audience: "drop_all",
      dropId: dropA.id,
      body: "Running 15 minutes behind — pickup now starts at 5:15pm.",
    });
    check("broadcast reached all 3 buyers", bc.sent === 3, `got ${bc.sent}`);

    const convos = await prisma.conversation.findMany({ where: { sellerId: vendorA.id } });
    check("one conversation per customer, no group thread", convos.length === 3, `got ${convos.length}`);

    const annMsgs = await prisma.message.findMany({
      where: { broadcastId: bc.broadcastId!, messageType: "announcement" },
      select: { conversationId: true },
    });
    check("each recipient got their own message row", annMsgs.length === 3);
    check(
      "announcements landed in 3 distinct conversations",
      new Set(annMsgs.map((m) => m.conversationId)).size === 3
    );

    // A reply to a broadcast stays private to that one conversation.
    const devConvo = convos.find((c) => c.customerId === dev!.id)!;
    await sendMessage({
      conversationId: devConvo.id,
      senderType: "customer",
      senderCustomerId: dev!.id,
      body: "No problem, see you then.",
    });
    const sarahThread = await threadMessages(convo.id);
    check(
      "broadcast reply is not visible to another customer",
      !sarahThread.some((m) => m.body === "No problem, see you then.")
    );

    // ── 8. Audience filters ────────────────────────────────────────────────
    const summary = await dropCommunicationSummary(vendorA.id, dropA.id);
    check("audience drop_all = 3", summary.counts.drop_all === 3, `got ${summary.counts.drop_all}`);
    check("audience active_orders = 3", summary.counts.active_orders === 3, `got ${summary.counts.active_orders}`);
    check("audience ready_pickup = 1", summary.counts.ready_pickup === 1, `got ${summary.counts.ready_pickup}`);

    const selected = await sendBroadcast({
      sellerId: vendorA.id,
      audience: "selected",
      dropId: dropA.id,
      body: "Quick note just for you.",
      selectedCustomerIds: [sarah!.id],
    });
    check("selected-audience broadcast hit exactly 1", selected.sent === 1, `got ${selected.sent}`);

    // ── 9. Unread totals roll up across conversations ──────────────────────
    const vTotal = await vendorUnreadTotal(vendorA.id);
    check("vendor unread total counts only replies", vTotal === 1, `got ${vTotal}`);
    const cTotal = await customerUnreadTotal(sarah!.id);
    check("customer unread total accumulates", cTotal >= 3, `got ${cTotal}`);

    // ── 10. Validation: empty and oversized bodies ──────────────────────────
    let emptyRejected = false;
    try {
      await sendMessage({ conversationId: convo.id, senderType: "vendor", senderSellerId: vendorA.id, body: "   " });
    } catch {
      emptyRejected = true;
    }
    check("empty message rejected", emptyRejected);

    let longRejected = false;
    try {
      await sendMessage({
        conversationId: convo.id,
        senderType: "vendor",
        senderSellerId: vendorA.id,
        body: "x".repeat(MAX_BODY + 1),
      });
    } catch {
      longRejected = true;
    }
    check("oversized message rejected", longRejected);

    // A long-but-legal message must survive intact.
    const longBody = "y".repeat(MAX_BODY - 1);
    const longMsg = await sendMessage({
      conversationId: convo.id,
      senderType: "vendor",
      senderSellerId: vendorA.id,
      body: longBody,
    });
    check("max-length message stored without truncation", longMsg.message.body.length === MAX_BODY - 1);

    // ── 11. Rapid-fire sends keep ordering and counters correct ────────────
    const before = (await prisma.conversation.findUnique({ where: { id: convo.id } }))!.customerUnread;
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sendMessage({
          conversationId: convo.id,
          senderType: "vendor",
          senderSellerId: vendorA.id,
          body: `rapid ${i}`,
        })
      )
    );
    const after = (await prisma.conversation.findUnique({ where: { id: convo.id } }))!.customerUnread;
    check("5 concurrent sends counted exactly once each", after - before === 5, `delta ${after - before}`);
    const rapid = await prisma.message.count({ where: { conversationId: convo.id, body: { startsWith: "rapid " } } });
    check("no messages lost under concurrency", rapid === 5, `got ${rapid}`);

    // ── 12. Concurrent conversation creation doesn't duplicate ─────────────
    const ana = await prisma.customer.findUnique({ where: { email: buyers[2].email } });
    await prisma.conversation.deleteMany({ where: { sellerId: vendorA.id, customerId: ana!.id } });
    const raced = await Promise.all([
      getOrCreateConversation(vendorA.id, ana!.id),
      getOrCreateConversation(vendorA.id, ana!.id),
      getOrCreateConversation(vendorA.id, ana!.id),
    ]);
    check("racing creates collapse to one conversation", new Set(raced.map((r) => r.id)).size === 1);

    // ── 13. Magic-link tokens are single-use ───────────────────────────────
    const raw = await createMagicLinkToken(sarah!.id);
    check("magic link resolves to its customer", (await consumeMagicLinkToken(raw))?.customerId === sarah!.id);
    check("magic link cannot be replayed", (await consumeMagicLinkToken(raw)) === null);
    check("garbage token rejected", (await consumeMagicLinkToken("nope")) === null);

    // Follow intent rides the token, not the redirect URL, so it can't be
    // forged by editing the link.
    const intentRaw = await createMagicLinkToken(sarah!.id, { followSellerId: vendorA.id });
    const consumedIntent = await consumeMagicLinkToken(intentRaw);
    check("follow intent survives the magic link", consumedIntent?.followSellerId === vendorA.id);
    const plainRaw = await createMagicLinkToken(sarah!.id);
    check("no intent when none was requested", (await consumeMagicLinkToken(plainRaw))?.followSellerId === null);

    // ── 13b. OAuth identity linking (Auth.js front door) ───────────────────
    const oauthEmail = `oauth-${stamp}@example.com`;
    const sub1 = `google-sub-${stamp}`;

    // New customer from a verified Google identity.
    const r1 = await linkOAuthCustomer({
      provider: "google", providerAccountId: sub1,
      email: oauthEmail, emailVerified: true, name: "OAuth Tester",
    });
    check("google sign-in creates a customer", r1.ok && r1.outcome === "created");

    // Repeat login resolves to the SAME customer — no duplicate.
    const r2 = await linkOAuthCustomer({
      provider: "google", providerAccountId: sub1,
      email: oauthEmail, emailVerified: true,
    });
    check("repeat google login reuses the same customer",
      r2.ok && r1.ok && r2.customerId === r1.customerId && r2.outcome === "existing_link");
    check("no duplicate customer created",
      (await prisma.customer.count({ where: { email: oauthEmail } })) === 1);

    // Same Google identity, email changed at Google — still the same customer.
    const r3 = await linkOAuthCustomer({
      provider: "google", providerAccountId: sub1,
      email: `changed-${stamp}@example.com`, emailVerified: true,
    });
    check("changed google email still resolves to the same customer",
      r3.ok && r1.ok && r3.customerId === r1.customerId);

    // An existing magic-link customer signing in with Google gets LINKED.
    const r4 = await linkOAuthCustomer({
      provider: "google", providerAccountId: `google-sub-b-${stamp}`,
      email: sarah!.email, emailVerified: true,
    });
    check("existing customer links by verified email",
      r4.ok && r4.customerId === sarah!.id && r4.outcome === "linked_by_email");
    check("linking did not duplicate the existing customer",
      (await prisma.customer.count({ where: { email: sarah!.email } })) === 1);

    // UNVERIFIED email must never claim an existing account.
    const r5 = await linkOAuthCustomer({
      provider: "google", providerAccountId: `attacker-${stamp}`,
      email: ana!.email, emailVerified: false,
    });
    check("unverified email cannot claim an account", !r5.ok && r5.reason === "unverified_email");
    check("refused sign-in created nothing",
      (await prisma.customerAccount.count({ where: { providerAccountId: `attacker-${stamp}` } })) === 0);

    // ── 14. Customer context is scoped to the asking vendor ────────────────
    const ctx = await customerContext(vendorA.id, sarah!.id);
    check("context shows the customer's name", ctx?.name === "Sarah Martinez");
    check("context counts this vendor's orders only", ctx?.totalOrders === 1, `got ${ctx?.totalOrders}`);
    const foreignCtx = await customerContext(vendorB.id, sarah!.id);
    check("vendor B sees no order history for her", foreignCtx?.totalOrders === 0, `got ${foreignCtx?.totalOrders}`);

    // ── 15. Customer inbox spans vendors ───────────────────────────────────
    const convoB = await getOrCreateConversation(vendorB.id, sarah!.id);
    await sendMessage({
      conversationId: convoB.id,
      senderType: "vendor",
      senderSellerId: vendorB.id,
      body: "Hello from the other store.",
    });
    const inbox = await customerConversationRows(sarah!.id);
    check("customer inbox lists both vendors", inbox.length === 2, `got ${inbox.length}`);
    check("inbox rows are labelled by store name", inbox.some((r) => r.name === "Rival Bakery"));

    // ── 16. Delivery channels recorded, SMS gated off ──────────────────────
    const deliveries = await prisma.messageDelivery.findMany({
      where: { message: { conversationId: convo.id } },
      select: { channel: true, status: true },
    });
    check("in_app delivery always recorded", deliveries.some((d) => d.channel === "in_app" && d.status === "sent"));
    check(
      "sms skipped while the channel is disabled",
      deliveries.filter((d) => d.channel === "sms").every((d) => d.status === "skipped")
    );

    await markAllNotificationsRead({ kind: "customer", customerId: sarah!.id });
    check(
      "mark all as read clears the badge",
      (await unreadNotificationCount({ kind: "customer", customerId: sarah!.id })) === 0
    );
  } catch (e) {
    check("suite ran to completion", false, e instanceof Error ? e.message : String(e));
    await prisma.customerAccount.deleteMany({ where: { providerAccountId: { contains: stamp } } });
    await prisma.customer.deleteMany({ where: { email: { contains: `oauth-${stamp}` } } });
    await prisma.customer.deleteMany({ where: { email: { contains: `changed-${stamp}` } } });
  } finally {
    // Cascades clean up drops, orders, conversations, messages, notifications.
    await prisma.seller.deleteMany({ where: { id: { in: madeSellerIds } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { id: { in: madeCustomerIds } } }).catch(() => {});
    // 13b's OAuth customer is created by linkOAuthCustomer(), which never adds
    // it to madeCustomerIds — so it was only cleaned up in the CATCH path, and
    // every SUCCESSFUL run left one behind. Fourteen "OAuth Tester" rows had
    // accumulated in production since 2026-08-14 before this was noticed.
    await prisma.customerAccount.deleteMany({ where: { providerAccountId: { contains: stamp } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { email: { contains: `oauth-${stamp}` } } }).catch(() => {});
    await prisma.customer.deleteMany({ where: { email: { contains: `changed-${stamp}` } } }).catch(() => {});
  }

  const failed = results.filter((r) => !r.pass);
  return NextResponse.json(
    {
      passed: results.length - failed.length,
      failed: failed.length,
      failures: failed,
      results,
    },
    { status: failed.length === 0 ? 200 : 500 }
  );
}
