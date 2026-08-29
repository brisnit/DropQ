/**
 * What happens to a drop item the vendor removed from the editor.
 *
 * Pure, so the rule can be asserted without a database — and it is a rule that
 * badly needs asserting, because getting it wrong destroys the link between a
 * customer's order and the thing they bought.
 *
 * THE RULE:
 *
 *     An item nobody has bought is deleted.
 *     An item somebody HAS bought is never deleted — it is retired.
 *
 * "Retired" means `inventory = sold`: no units remain, so every purchase path
 * already refuses it. That is not a new mechanism, it is the one the product
 * has always used for "sold out", enforced in four independent places:
 *
 *   - the storefront renders it sold out and disables Add
 *     (components/storefront-order.tsx)
 *   - the inventory poll flips an already-open tab
 *     (app/api/drops/[id]/inventory/route.ts)
 *   - placeOrderAction rejects the line before charging
 *   - the write itself is `UPDATE … WHERE sold + qty <= inventory`, so even a
 *     forged request cannot get past it
 *
 * Choosing retirement over a new `archivedAt` column is deliberate. Hiding the
 * row instead would mean filtering it out of six separate purchase-path reads,
 * and missing one of them would let a customer buy an item the vendor believes
 * they removed — a worse failure than the one this fixes. See
 * docs/VENDOR-GUIDANCE.md.
 *
 * ⚠️ Historical integrity is the point. `OrderItem` already snapshots name and
 * price and its FK is `SetNull`, so deleting never corrupted an order — but it
 * did sever `OrderItem.productId`, taking per-item sell-through and the drop's
 * Sold count with it. Retiring keeps all of it.
 */

export type RemovalPlan = {
  /** Safe to delete: no order has ever referenced these. */
  deletable: string[];
  /** Must be kept and retired: real purchases point at these. */
  retirable: string[];
};

/**
 * Split the removed product ids by whether an order references them.
 *
 * @param removedIds  products present on the drop but absent from the submitted form
 * @param idsWithOrders  of those, the ones an OrderItem points at
 *
 * Order is preserved and duplicates are collapsed, so the caller can use the
 * result directly in a query without re-normalising. An id in `idsWithOrders`
 * that is not in `removedIds` is ignored rather than trusted — the caller reads
 * that set from the database, but this function is the one that decides, and it
 * should not be possible to widen a deletion by passing a bad set.
 */
export function planRemovals(
  removedIds: readonly string[],
  idsWithOrders: readonly string[]
): RemovalPlan {
  const linked = new Set(idsWithOrders);
  const seen = new Set<string>();
  const deletable: string[] = [];
  const retirable: string[] = [];

  for (const id of removedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (linked.has(id)) retirable.push(id);
    else deletable.push(id);
  }

  return { deletable, retirable };
}

/**
 * The warning shown before a vendor removes an item that has orders.
 *
 * Says what survives, not just what stops — a vendor who reads "this has 4
 * orders" and nothing else will reasonably assume those orders are at risk.
 */
export function removalWarning(name: string, orderCount: number): string {
  const one = orderCount === 1;
  const count = `${orderCount} order${one ? "" : "s"}`;
  const kept = one ? "That order is kept" : "Those orders are kept";
  return (
    `“${name}” has ${count}. Removing it stops new orders and shows it as ` +
    `sold out on your storefront. ${kept}, along with your sales history. ` +
    `Remove it?`
  );
}
