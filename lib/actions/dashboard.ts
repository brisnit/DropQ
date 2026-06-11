"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { dollarsToCents } from "@/lib/format";
import { saveImage } from "@/lib/upload";

/* ----------------------------- Store profile ---------------------------- */
export async function updateStoreAction(formData: FormData) {
  const seller = await requireSeller();
  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      storeName: String(formData.get("storeName") ?? seller.storeName).trim() || seller.storeName,
      tagline: String(formData.get("tagline") ?? "").trim() || null,
      bio: String(formData.get("bio") ?? "").trim() || null,
      location: String(formData.get("location") ?? "").trim() || null,
      accent: String(formData.get("accent") ?? seller.accent) || seller.accent,
    },
  });
  revalidatePath("/dashboard/store");
  revalidatePath(`/s/${seller.slug}`);
}

/* ------------------------------- Drops ---------------------------------- */
export async function createDropAction(formData: FormData) {
  const seller = await requireSeller();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return; // basic guard; client enforces required

  const status = String(formData.get("status") ?? "draft");
  const opensAt = formData.get("opensAt") ? new Date(String(formData.get("opensAt"))) : null;
  const closesAt = formData.get("closesAt") ? new Date(String(formData.get("closesAt"))) : null;

  // Parse parallel product arrays (one entry per row, aligned by index)
  const names = formData.getAll("p_name").map(String);
  const descs = formData.getAll("p_desc").map(String);
  const prices = formData.getAll("p_price").map(String);
  const emojis = formData.getAll("p_emoji").map(String);
  const invs = formData.getAll("p_inventory").map(String);
  const images = formData.getAll("p_image"); // File entries, may be empty

  // Save uploaded photos (in parallel), preserving row order
  const imageUrls = await Promise.all(images.map((img) => saveImage(img)));

  const products = names
    .map((name, i) => ({
      name: name.trim(),
      description: (descs[i] ?? "").trim() || null,
      priceCents: dollarsToCents(prices[i] ?? "0"),
      emoji: (emojis[i] ?? "🍪").trim() || "🍪",
      imageUrl: imageUrls[i] ?? null,
      inventory: Math.max(0, parseInt(invs[i] ?? "0", 10) || 0),
      sortOrder: i,
    }))
    .filter((p) => p.name.length > 0);

  const drop = await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      status: status === "live" ? "live" : "draft",
      fulfillment: String(formData.get("fulfillment") ?? "pickup"),
      pickupInfo: String(formData.get("pickupInfo") ?? "").trim() || null,
      opensAt,
      closesAt,
      products: { create: products },
    },
  });

  revalidatePath("/dashboard/drops");
  redirect(`/dashboard/drops/${drop.id}`);
}

export async function updateDropStatusAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));
  const status = String(formData.get("status"));
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop || drop.sellerId !== seller.id) return;
  await prisma.drop.update({ where: { id: dropId }, data: { status } });
  revalidatePath(`/dashboard/drops/${dropId}`);
  revalidatePath("/dashboard/drops");
  revalidatePath("/dashboard");
  revalidatePath(`/s/${seller.slug}`);
}

export async function deleteDropAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop || drop.sellerId !== seller.id) return;
  await prisma.drop.delete({ where: { id: dropId } });
  revalidatePath("/dashboard/drops");
  redirect("/dashboard/drops");
}

/* ------------------------------- Orders --------------------------------- */
export async function updateOrderStatusAction(formData: FormData) {
  const seller = await requireSeller();
  const orderId = String(formData.get("orderId"));
  const status = String(formData.get("status"));
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.sellerId !== seller.id) return;
  await prisma.order.update({ where: { id: orderId }, data: { status } });
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/drops/${order.dropId}`);
  revalidatePath("/dashboard");
}
