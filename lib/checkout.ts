import "server-only";
import { prisma } from "@/lib/db";

/**
 * Mark a pending order as paid and decrement inventory — exactly once.
 * Safe to call from both the Stripe webhook and the success page (idempotent).
 */
export async function finalizePaidOrder(
  orderId: string,
  paymentIntentId?: string | null
) {
  return prisma.$transaction(async (tx) => {
    // Atomically claim the order: only the first caller flips it out of "pending".
    const claimed = await tx.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: {
        status: "new",
        paymentStatus: "paid",
        ...(paymentIntentId ? { stripePaymentIntentId: paymentIntentId } : {}),
      },
    });

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return null;

    // Already finalized by someone else — nothing more to do.
    if (claimed.count === 0) return order;

    await tx.orderEvent.create({ data: { orderId, type: "payment", detail: "paid" } });

    for (const it of order.items) {
      if (!it.productId) continue; // product removed from the drop since order
      await tx.product.update({
        where: { id: it.productId },
        data: { sold: { increment: it.quantity } },
      });
    }
    return order;
  });
}
