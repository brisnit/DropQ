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
import { sendSms } from "@/lib/notifications";
import { geocode } from "@/lib/geofence";
import { canCreateDrop } from "@/lib/plans";
import { ORDER_STATUSES } from "@/lib/orders";
import { SOCIALS, normalizeSocialUrl } from "@/lib/social";

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

  // Header/banner image: same upload-wins / remove / keep logic.
  const newHeader = await saveImage(formData.get("headerImage"));
  const removeHeader = formData.get("removeHeader") === "1";
  const headerImageUrl = newHeader ?? (removeHeader ? null : seller.headerImageUrl);

  const accentRaw = String(formData.get("accent") ?? seller.accent).trim();
  const accent = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(accentRaw) ? accentRaw : seller.accent;

  // Social links — normalize handles/partial URLs to full https URLs.
  const socials = Object.fromEntries(
    SOCIALS.map((s) => [s.key, normalizeSocialUrl(s.key, String(formData.get(`social_${s.key}`) ?? ""))])
  );
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
      headerImageUrl,
      accent,
      instagram: socials.instagram,
      tiktok: socials.tiktok,
      twitter: socials.twitter,
      facebook: socials.facebook,
      youtube: socials.youtube,
      website: socials.website,
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

/* ------------------------------ Gallery --------------------------------- */
export async function addGalleryImagesAction(formData: FormData) {
  const seller = await requireSeller();
  const files = formData.getAll("galleryImages");
  const urls = (await Promise.all(files.map((f) => saveImage(f)))).filter(
    (u): u is string => !!u
  );
  if (urls.length) {
    const start = await prisma.galleryImage.count({ where: { sellerId: seller.id } });
    await prisma.galleryImage.createMany({
      data: urls.map((url, i) => ({ sellerId: seller.id, url, sortOrder: start + i })),
    });
  }
  revalidatePath("/dashboard/store");
  revalidatePath(`/s/${seller.slug}`);
  redirect("/dashboard/store#gallery");
}

export async function deleteGalleryImageAction(formData: FormData) {
  const seller = await requireSeller();
  const imageId = String(formData.get("imageId") ?? "");
  // Scope the delete to the current seller so nobody can remove another's photo.
  await prisma.galleryImage.deleteMany({ where: { id: imageId, sellerId: seller.id } });
  revalidatePath("/dashboard/store");
  revalidatePath(`/s/${seller.slug}`);
  redirect("/dashboard/store#gallery");
}

/* ------------------------------- Drops ---------------------------------- */
export async function createDropAction(formData: FormData) {
  const seller = await requireSeller();

  // Plan gate: Starter is capped at a lifetime number of drops.
  if (!canCreateDrop(seller)) {
    redirect("/dashboard/billing?limit=1");
  }

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return; // basic guard; client enforces required

  const liveMode = String(formData.get("mode") ?? "preorder") === "live";
  const statusRaw = String(formData.get("status") ?? "draft");
  // Live drops open immediately; regular drops honor the chosen status.
  const status = liveMode || statusRaw === "live" ? "live" : "draft";

  const now = new Date();
  const opensAt = formData.get("opensAt")
    ? new Date(String(formData.get("opensAt")))
    : liveMode
      ? now
      : null;
  const closesAt = formData.get("closesAt")
    ? new Date(String(formData.get("closesAt")))
    : liveMode
      ? new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30)
      : null;

  // Parse parallel product arrays (one entry per row, aligned by index)
  const names = formData.getAll("p_name").map(String);
  const descs = formData.getAll("p_desc").map(String);
  const prices = formData.getAll("p_price").map(String);
  const emojis = formData.getAll("p_emoji").map(String);
  const invs = formData.getAll("p_inventory").map(String);
  const types = formData.getAll("p_type").map(String);
  const conditions = formData.getAll("p_condition").map(String);
  const rarities = formData.getAll("p_rarity").map(String);
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
      productType: (types[i] ?? "").trim() || null,
      condition: (conditions[i] ?? "").trim() || null,
      rarity: (rarities[i] ?? "").trim() || null,
    }))
    .filter((p) => p.name.length > 0);

  const drop = await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title,
      description: String(formData.get("description") ?? "").trim() || null,
      mode: liveMode ? "live" : "preorder",
      status,
      fulfillment: String(formData.get("fulfillment") ?? "pickup"),
      pickupInfo: String(formData.get("pickupInfo") ?? "").trim() || null,
      opensAt,
      closesAt,
      products: { create: products },
    },
  });

  // Count it against the lifetime allowance (never decremented, so deleting a
  // drop doesn't refund a Starter slot).
  await prisma.seller.update({
    where: { id: seller.id },
    data: { dropsCreated: { increment: 1 } },
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
  const types = formData.getAll("p_type").map(String);
  const conditions = formData.getAll("p_condition").map(String);
  const rarities = formData.getAll("p_rarity").map(String);
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
      productType: (types[i] ?? "").trim() || null,
      condition: (conditions[i] ?? "").trim() || null,
      rarity: (rarities[i] ?? "").trim() || null,
    };
    const newImage = imageUrls[i] ?? null;
    const id = ids[i];
    if (id) {
      submittedIds.add(id);
      const keptImage = (keepImages[i] ?? "") || null;
      // Scope to this drop so a crafted p_id can't overwrite another vendor's product.
      await prisma.product.updateMany({
        where: { id, dropId },
        data: { ...base, imageUrl: newImage ?? keptImage },
      });
    } else {
      await prisma.product.create({ data: { ...base, dropId, imageUrl: newImage } });
    }
  }
  const removed = drop.products.filter((p) => !submittedIds.has(p.id)).map((p) => p.id);
  if (removed.length) await prisma.product.deleteMany({ where: { id: { in: removed }, dropId } });

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
  // Guard against unknown statuses from a stale/tampered form.
  if (!ORDER_STATUSES.includes(status as (typeof ORDER_STATUSES)[number])) return;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { drop: { select: { pickupInfo: true, fulfillment: true } } },
  });
  if (!order || order.sellerId !== seller.id) return;

  const prev = order.status;
  if (status === prev) return;

  await prisma.order.update({
    where: { id: orderId },
    data: { status, events: { create: { type: "status", detail: status } } },
  });

  // Text (+ email) the customer when their order status changes.
  {
    const link = `${await baseUrl()}/order/${order.id}`;
    const first = order.buyerName.split(" ")[0] || order.buyerName;
    const store = seller.storeName;
    const isPickup = (order.drop.fulfillment ?? "pickup") === "pickup";
    let sms: string | null = null;
    let mail: Parameters<typeof sendEmail>[0] | null = null;

    if (status === "ready") {
      const where = order.drop.pickupInfo ? ` ${order.drop.pickupInfo}` : "";
      sms = `${store}: Your order is ready${isPickup ? " for pickup" : ""}! 🎉${where} ${link}`;
      mail = orderReadyEmail({
        to: order.buyerEmail,
        storeName: store,
        buyerFirst: first,
        orderLink: link,
        pickupInfo: order.drop.pickupInfo,
        fulfillment: order.drop.fulfillment,
      });
    } else if (status === "completed") {
      sms = `${store}: Thanks for your order, ${first}! 🙌 See you at the next drop.`;
    } else if (status === "canceled") {
      sms = `${store}: Your order was canceled. Reach out to the maker with any questions.`;
    }

    if (sms || mail) {
      after(async () => {
        if (mail) await sendEmail(mail);
        if (sms) await sendSms(order.buyerPhone, sms);
      });
    }
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/drops/${order.dropId}`);
  revalidatePath("/dashboard");
}
