"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCustomer } from "@/lib/customer-auth";
import { getOrCreateConversation } from "@/lib/messaging";

/**
 * "Message this vendor" from an order. The customer-side mirror of the
 * vendor's Message Customer button: opens (or reuses) the one conversation
 * between them, carrying the order and drop context in.
 */
export async function messageVendorFromOrderAction(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const orderId = String(formData.get("orderId") ?? "");

  // Scoped — a customer can only start a conversation from their own order.
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: customer.id },
    select: { id: true, sellerId: true, dropId: true },
  });
  if (!order) redirect("/my/orders");

  const convo = await getOrCreateConversation(order.sellerId, customer.id, {
    dropId: order.dropId,
    orderId: order.id,
  });

  redirect(`/messages/${convo.id}`);
}
