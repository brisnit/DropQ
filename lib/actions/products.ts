"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { dollarsToCents } from "@/lib/format";
import { PRODUCT_MINIMUM_ERROR, belowProductMinimum } from "@/lib/checkout-session";

export type ProductSaveState = { saved?: boolean; error?: string };

// Read the shared product fields from a form submission.
function parseProduct(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const images = formData.getAll("images").map(String).filter(Boolean);
  return {
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    priceCents: dollarsToCents(String(formData.get("price") ?? "0")),
    emoji: String(formData.get("emoji") ?? "🍪").trim() || "🍪",
    images,
    imageUrl: images[0] ?? null,
    category: String(formData.get("category") ?? "").trim() || null,
    allergens: String(formData.get("allergens") ?? "").trim() || null,
    productType: String(formData.get("productType") ?? "").trim() || null,
    condition: String(formData.get("condition") ?? "").trim() || null,
    rarity: String(formData.get("rarity") ?? "").trim() || null,
  };
}

/** Create a saved product in the vendor's library. */
export async function createVendorProductAction(
  _prev: ProductSaveState,
  formData: FormData
): Promise<ProductSaveState> {
  const seller = await requireSeller();
  const data = parseProduct(formData);
  if (!data.name) return { error: "Give your product a name." };
  // Stripe cannot charge less than $0.50, so a product priced below it can only
  // ever be sold in a bundle — and on its own it produces a checkout that fails
  // at the payment step for the buyer. Rejected, never rounded up: a silently
  // adjusted price is a vendor discovering their own listing lied to them.
  if (belowProductMinimum(data.priceCents)) return { error: PRODUCT_MINIMUM_ERROR };
  try {
    await prisma.vendorProduct.create({ data: { sellerId: seller.id, ...data } });
    revalidatePath("/dashboard/products");
    return { saved: true };
  } catch (e) {
    console.error("createVendorProductAction failed:", e);
    return { error: "Couldn't save that product. Please try again." };
  }
}

/** Update an existing saved product (scoped to the current vendor). */
export async function updateVendorProductAction(
  _prev: ProductSaveState,
  formData: FormData
): Promise<ProductSaveState> {
  const seller = await requireSeller();
  const id = String(formData.get("id") ?? "");
  const data = parseProduct(formData);
  if (!data.name) return { error: "Give your product a name." };
  // Stripe cannot charge less than $0.50, so a product priced below it can only
  // ever be sold in a bundle — and on its own it produces a checkout that fails
  // at the payment step for the buyer. Rejected, never rounded up: a silently
  // adjusted price is a vendor discovering their own listing lied to them.
  if (belowProductMinimum(data.priceCents)) return { error: PRODUCT_MINIMUM_ERROR };
  try {
    // updateMany scoped to sellerId so a crafted id can't touch another's item.
    const res = await prisma.vendorProduct.updateMany({
      where: { id, sellerId: seller.id },
      data,
    });
    if (res.count === 0) return { error: "Product not found." };
    revalidatePath("/dashboard/products");
    return { saved: true };
  } catch (e) {
    console.error("updateVendorProductAction failed:", e);
    return { error: "Couldn't update that product. Please try again." };
  }
}

/** Toggle a saved product active/inactive (inactive items are hidden from the picker). */
export async function toggleVendorProductAction(formData: FormData) {
  const seller = await requireSeller();
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  await prisma.vendorProduct.updateMany({
    where: { id, sellerId: seller.id },
    data: { isActive: active },
  });
  revalidatePath("/dashboard/products");
}

/** Delete a saved product. Live drops keep their copy (Product row is separate). */
export async function deleteVendorProductAction(formData: FormData) {
  const seller = await requireSeller();
  const id = String(formData.get("id") ?? "");
  await prisma.vendorProduct.deleteMany({ where: { id, sellerId: seller.id } });
  revalidatePath("/dashboard/products");
}
