"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { dollarsToCents } from "@/lib/format";
import { saveImage } from "@/lib/upload";
import { sendEmail, orderReadyEmail } from "@/lib/email";
import { geocode } from "@/lib/geofence";

async function baseUrl(): Promise<string> {
  const h = await headers();
  const env = process.env.APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${h.get("host") ?? "localhost:3000"}`;
}

/* ----------------------------- Store profile ---------------------------- */
export type StoreSaveState = { saved?: boolean; error?: string };

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

export async function updateStoreAction(
  _prev: StoreSaveState,
  formData: FormData
): Promise<StoreSaveState> {
  const seller = await requireSeller();
  const location = String(formData.get("location") ?? "").trim() || null;

  // Logo: new upload wins; else honor an explicit remove; else keep existing.
  const newLogo = await saveImage(formData.get("logo"));
  const removeLogo = formData.get("removeLogo") === "1";
  const logoUrl = newLogo ?? (removeLogo ? null : seller.logoUrl);

  const accentRaw = String(formData.get("accent") ?? seller.accent).trim();
  const accent = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(accentRaw) ? accentRaw : seller.accent;
  const geofenceEnabled = formData.get("geofenceEnabled") === "on";
  let latitude = numOrNull(formData.get("latitude"));
  let longitude = numOrNull(formData.get("longitude"));

  // Auto-geocode from the Location text when geofencing is on and no manual
  // coordinates were entered (best-effort; never blocks the save).
  if (geofenceEnabled && (latitude == null || longitude == null) && location) {
    const geo = await geocode(location);
    if (geo) {
      latitude = geo.lat;
      longitude = geo.lng;
    }
  }

  await prisma.seller.update({
    where: { id: seller.id },
    data: {
      storeName: String(formData.get("storeName") ?? seller.storeName).trim() || seller.storeName,
      tagline: String(formData.get("tagline") ?? "").trim() || null,
      bio: String(formData.get("bio") ?? "").trim() || null,
      location,
      logoUrl,
      accent,
      feeMode: String(formData.get("feeMode")) === "pass" ? "pass" : "absorb",
      geofenceEnabled,
      latitude,
      longitude,
      geofenceRadiusM: Math.max(
        100,
        parseInt(String(formData.get("geofenceRadiusM") ?? "1500"), 10) || 1500
      ),
    },
  });
  revalidatePath("/dashboard/store");
  revalidatePath(`/s/${seller.slug}`);
  return { saved: true };
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

// Full edit: updates the drop in place (never duplicates) and syncs its items.
export async function updateDropFullAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));
  const drop = await prisma.drop.findUnique({ where: { id: dropId }, include: { products: true } });
  if (!drop || drop.sellerId !== seller.id) return;

  const title = String(formData.get("title") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? drop.status);
  const status = ["draft", "live", "closed"].includes(statusRaw) ? statusRaw : drop.status;
  const opensAt = formData.get("opensAt") ? new Date(String(formData.get("opensAt"))) : drop.opensAt;
  const closesAt = formData.get("closesAt") ? new Date(String(formData.get("closesAt"))) : drop.closesAt;

  await prisma.drop.update({
    where: { id: dropId },
    data: {
      title: title || drop.title,
      description: String(formData.get("description") ?? "").trim() || null,
      fulfillment: String(formData.get("fulfillment") ?? drop.fulfillment) || drop.fulfillment,
      pickupInfo: String(formData.get("pickupInfo") ?? "").trim() || null,
      status,
      opensAt,
      closesAt,
    },
  });

  // Sync products (update existing, create new, delete removed)
  const ids = formData.getAll("p_id").map(String);
  const names = formData.getAll("p_name").map(String);
  const descs = formData.getAll("p_desc").map(String);
  const prices = formData.getAll("p_price").map(String);
  const emojis = formData.getAll("p_emoji").map(String);
  const invs = formData.getAll("p_inventory").map(String);
  const keepImages = formData.getAll("p_keep_image").map(String);
  const images = formData.getAll("p_image");
  const imageUrls = await Promise.all(images.map((img) => saveImage(img)));

  const submittedIds = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    const base = {
      name,
      description: (descs[i] ?? "").trim() || null,
      priceCents: dollarsToCents(prices[i] ?? "0"),
      emoji: (emojis[i] ?? "🍪").trim() || "🍪",
      inventory: Math.max(0, parseInt(invs[i] ?? "0", 10) || 0),
      sortOrder: i,
    };
    const newImage = imageUrls[i] ?? null;
    const id = ids[i];
    if (id) {
      submittedIds.add(id);
      const keptImage = (keepImages[i] ?? "") || null;
      await prisma.product.update({
        where: { id },
        data: { ...base, imageUrl: newImage ?? keptImage },
      });
    } else {
      await prisma.product.create({ data: { ...base, dropId, imageUrl: newImage } });
    }
  }
  const removed = drop.products.filter((p) => !submittedIds.has(p.id)).map((p) => p.id);
  if (removed.length) await prisma.product.deleteMany({ where: { id: { in: removed } } });

  revalidatePath(`/dashboard/drops/${dropId}`);
  revalidatePath("/dashboard/drops");
  revalidatePath(`/s/${seller.slug}`);
  revalidatePath(`/s/${seller.slug}/${dropId}`);
  redirect(`/dashboard/drops/${dropId}`);
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
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { drop: { select: { pickupInfo: true, fulfillment: true } } },
  });
  if (!order || order.sellerId !== seller.id) return;

  await prisma.order.update({ where: { id: orderId }, data: { status } });

  // Notify the customer when their order becomes ready (only on transition).
  if (status === "ready" && order.status !== "ready") {
    const mail = orderReadyEmail({
      to: order.buyerEmail,
      storeName: seller.storeName,
      buyerFirst: order.buyerName.split(" ")[0] || order.buyerName,
      orderLink: `${await baseUrl()}/order/${order.id}`,
      pickupInfo: order.drop.pickupInfo,
      fulfillment: order.drop.fulfillment,
    });
    after(() => sendEmail(mail)); // deliver in the background
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/drops/${order.dropId}`);
  revalidatePath("/dashboard");
}
