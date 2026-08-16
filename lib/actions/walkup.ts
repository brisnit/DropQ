"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { canStartInPersonSale } from "@/lib/payments";
import {
  isWalkUpEnabled,
  newWalkUpToken,
  validateWalkUpLines,
  walkUpExpiry,
  walkUpSaleState,
  type RequestedLine,
} from "@/lib/walkup";

/**
 * Vendor-side walk-up sale actions (Phase D).
 *
 * These create and cancel a temporary cart. They deliberately do NOT:
 * create an Order · call Stripe · touch inventory · award DropPoints ·
 * record a customer relationship. All of that belongs to Phase E and to the
 * existing payment pipeline.
 *
 * Authorization is server-side and non-negotiable: `requireSeller()`, then
 * ownership, then `canStartInPersonSale()` — the same predicate the UI uses, so
 * there is exactly one eligibility rule. Hiding the button is not the gate.
 */

/** Refuse loudly rather than half-creating something. */
function fail(dropId: string, reason: string): never {
  redirect(`/dashboard/drops/${dropId}?walkup_error=${encodeURIComponent(reason)}`);
}

export async function startWalkUpSaleAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId") ?? "");
  if (!dropId) redirect("/dashboard/drops");

  // Checked HERE, not only in the UI. In "internal" mode the seller decides
  // eligibility, so the gate needs them — availability must stay authoritative
  // even if the client is modified.
  if (!isWalkUpEnabled(seller)) fail(dropId, "unavailable");

  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: { products: { orderBy: { sortOrder: "asc" } } },
  });
  // Same shape as every other vendor-owned resource: a foreign drop is
  // indistinguishable from a missing one.
  if (!drop || drop.sellerId !== seller.id) redirect("/dashboard/drops");

  const eligible = canStartInPersonSale(seller, drop);
  if (!eligible.ok) fail(dropId, eligible.reason);

  // The client sends quantities only — never a price. Field naming matches the
  // storefront's `qty_<productId>` convention.
  const requested: RequestedLine[] = drop.products.map((p) => ({
    productId: p.id,
    quantity: Math.max(0, parseInt(String(formData.get(`qty_${p.id}`) ?? "0"), 10) || 0),
  }));

  const validated = validateWalkUpLines(drop, requested);
  if (!validated.ok) fail(dropId, validated.reason);

  const sale = await prisma.walkUpSale.create({
    data: {
      token: newWalkUpToken(),
      sellerId: seller.id,
      dropId: drop.id,
      lines: validated.lines,
      expiresAt: walkUpExpiry(),
    },
    select: { id: true },
  });

  revalidatePath(`/dashboard/drops/${dropId}`);
  redirect(`/dashboard/drops/${dropId}?walkup=${sale.id}`);
}

/**
 * Vendor taps "Cancel sale" / "Start over".
 *
 * Sets `canceledAt` and **never deletes the row** — a walk-up sale is a record
 * of something the vendor did, and Phase E's conversion logic keys off this
 * row's identity. Touches no inventory and creates no Order.
 */
export async function cancelWalkUpSaleAction(formData: FormData) {
  const seller = await requireSeller();
  const saleId = String(formData.get("saleId") ?? "");
  if (!saleId) redirect("/dashboard/drops");

  const sale = await prisma.walkUpSale.findUnique({
    where: { id: saleId },
    select: { id: true, sellerId: true, dropId: true, orderId: true, canceledAt: true, expiresAt: true },
  });
  if (!sale || sale.sellerId !== seller.id) redirect("/dashboard/drops");

  // Only an open sale can be canceled. A converted one is a real purchase and a
  // stale form must never rewrite it; an already-canceled one is a no-op.
  if (walkUpSaleState(sale) === "open") {
    await prisma.walkUpSale.updateMany({
      where: { id: sale.id, orderId: null, canceledAt: null },
      data: { canceledAt: new Date() },
    });
  }

  revalidatePath(`/dashboard/drops/${sale.dropId}`);
  redirect(`/dashboard/drops/${sale.dropId}`);
}
