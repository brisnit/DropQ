"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { voidCommissionForOrder } from "@/lib/commission";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSeller } from "@/lib/auth";
import { dollarsToCents } from "@/lib/format";
import { saveImage } from "@/lib/upload";
import {
  sendEmail,
  orderInProgressEmail,
  orderReadyEmail,
  orderCompletedEmail,
  orderCanceledEmail,
  vendorArrivedEmail,
} from "@/lib/email";
import { sendSms } from "@/lib/notifications";
import { sendGatedSms } from "@/lib/sms-gate";
import { formatPickupWindow, pickupLocation, pickupSummary, orderMailPickup } from "@/lib/pickup";
import { dropMapsUrl } from "@/lib/maps";
import { geocode } from "@/lib/geofence";
import { canCreateDrop } from "@/lib/plans";
import { ORDER_STATUSES } from "@/lib/orders";
import { resolveDropStatus } from "@/lib/payments";
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

/** Email + text customers who already ordered when pickup details change. */
async function notifyPickupChanged(dropId: string) {
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: { seller: { select: { storeName: true, timezone: true } } },
  });
  if (!drop) return;
  const orders = await prisma.order.findMany({
    where: { dropId, status: { in: ["new", "in_progress", "ready"] } },
    select: { buyerEmail: true, buyerPhone: true,
      customerId: true, buyerName: true },
  });
  if (!orders.length) return;

  const store = drop.seller.storeName;
  const summary = pickupSummary(drop, drop.seller.timezone);
  const win = formatPickupWindow(drop, drop.seller.timezone);
  const loc = pickupLocation(drop);
  const notes = drop.pickupNotes;

  for (const o of orders) {
    const first = o.buyerName.split(" ")[0] || o.buyerName;
    try {
      await sendEmail({
        to: o.buyerEmail,
        subject: `Pickup details updated for your ${store} order`,
        html:
          `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a">` +
          `<p>Hi ${first}, the pickup details for your <b>${store}</b> order have been updated:</p>` +
          (win ? `<p><b>Pickup:</b> ${win}</p>` : "") +
          (loc ? `<p><b>Where:</b> ${loc}</p>` : "") +
          (notes ? `<p><b>Notes:</b> ${notes}</p>` : "") +
          `</div>`,
      });
      await sendGatedSms({ kind: "transactional", body: `${store}: your pickup details were updated. ${summary}`, customerId: o.customerId, email: o.buyerEmail, to: o.buyerPhone });
    } catch (e) {
      console.error("notifyPickupChanged send failed:", e);
    }
  }
}

/** Parse the drop pickup-window + location fields from a drop form submission. */
function parsePickup(formData: FormData) {
  const dt = (k: string) => (formData.get(k) ? new Date(String(formData.get(k))) : null);
  return {
    pickupStartAt: dt("pickupStartAt"),
    pickupEndAt: dt("pickupEndAt"),
    pickupLocationName: String(formData.get("pickupLocationName") ?? "").trim() || null,
    pickupAddress: String(formData.get("pickupAddress") ?? "").trim() || null,
    pickupLat: numOrNull(formData.get("pickupLat")),
    pickupLng: numOrNull(formData.get("pickupLng")),
    pickupNotes: String(formData.get("pickupNotes") ?? "").trim() || null,
    pickupFindMe: String(formData.get("pickupFindMe") ?? "").trim() || null,
    pickupLine1: String(formData.get("pickupLine1") ?? "").trim() || null,
    pickupCity: String(formData.get("pickupCity") ?? "").trim() || null,
    pickupState: String(formData.get("pickupState") ?? "").trim() || null,
    pickupPostal: String(formData.get("pickupPostal") ?? "").trim() || null,
    pickupCountry: String(formData.get("pickupCountry") ?? "").trim() || null,
  };
}

export async function updateStoreAction(
  _prev: StoreSaveState,
  formData: FormData
): Promise<StoreSaveState> {
  const seller = await requireSeller();
  try {
  const location = String(formData.get("location") ?? "").trim() || null;

  // Logo / header arrive pre-uploaded as URLs (empty string = cleared).
  const logoUrl = String(formData.get("logoUrl") ?? "").trim() || null;
  const headerImageUrl = String(formData.get("headerImageUrl") ?? "").trim() || null;

  const accentRaw = String(formData.get("accent") ?? seller.accent).trim();
  const accent = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(accentRaw) ? accentRaw : seller.accent;

  // Public pickup contact — opt-in. Empty clears it (no public number exposed).
  const pickupContactPhone = String(formData.get("pickupContactPhone") ?? "").trim() || null;
  const prefRaw = String(formData.get("pickupContactPref") ?? "text").trim();
  const pickupContactPref = ["text", "call", "both"].includes(prefRaw) ? prefRaw : "text";

  // Timezone — accept a plausible IANA value (e.g. "America/New_York" or "UTC").
  const tzRaw = String(formData.get("timezone") ?? "").trim();
  const timezone = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$|^UTC$/.test(tzRaw) ? tzRaw : seller.timezone;

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
      timezone,
      instagram: socials.instagram,
      tiktok: socials.tiktok,
      twitter: socials.twitter,
      facebook: socials.facebook,
      youtube: socials.youtube,
      website: socials.website,
      feeMode: String(formData.get("feeMode")) === "pass" ? "pass" : "absorb",
      pickupContactPhone,
      pickupContactPref,
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
  } catch (e) {
    // Never crash the page on save — surface a friendly inline error instead.
    console.error("updateStoreAction failed:", e);
    return { error: "Something went wrong saving your profile. Please try again." };
  }
}

/* --------------------------- Discoverability ---------------------------- */
export type DiscoverabilityState = { saved?: boolean; error?: string };

/**
 * Vendor Finder opt-in settings. Discovery is strictly opt-in — a vendor only
 * appears on /discover when isDiscoverable is on. When enabled, we geocode the
 * public city/ZIP so the vendor can be placed on the distance-based search
 * (city-level coordinates only — never a residential address).
 */
export async function updateDiscoverabilityAction(
  _prev: DiscoverabilityState,
  formData: FormData
): Promise<DiscoverabilityState> {
  const seller = await requireSeller();
  try {
    const isDiscoverable = formData.get("isDiscoverable") === "on";
    const publicNeighborhood = String(formData.get("publicNeighborhood") ?? "").trim() || null;
    const publicCity = String(formData.get("publicCity") ?? "").trim() || null;
    const publicState = String(formData.get("publicState") ?? "").trim() || null;
    const publicZip = String(formData.get("publicZip") ?? "").trim() || null;
    const radiusRaw = parseInt(String(formData.get("discoveryRadius") ?? "25"), 10) || 25;
    const discoveryRadius = [10, 25, 50, 100].includes(radiusRaw) ? radiusRaw : 25;

    // Geocode a city-level point for distance search (best-effort).
    let latitude = seller.latitude;
    let longitude = seller.longitude;
    if (isDiscoverable) {
      const q = [publicCity, publicState, publicZip].filter(Boolean).join(", ");
      if (q) {
        const geo = await geocode(q);
        if (geo) { latitude = geo.lat; longitude = geo.lng; }
      }
    }

    await prisma.seller.update({
      where: { id: seller.id },
      data: {
        isDiscoverable,
        showActiveDropsInDiscovery: formData.get("showActiveDropsInDiscovery") === "on",
        showEventsInDiscovery: formData.get("showEventsInDiscovery") === "on",
        hideExactAddress: formData.get("hideExactAddress") === "on",
        publicNeighborhood, publicCity, publicState, publicZip, discoveryRadius,
        latitude, longitude,
      },
    });
    revalidatePath("/dashboard/discoverability");
    revalidatePath("/discover");
    return { saved: true };
  } catch (e) {
    console.error("updateDiscoverabilityAction failed:", e);
    return { error: "Couldn't save your discovery settings. Please try again." };
  }
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

/* --------------------------- Product library ---------------------------- */
type LibRow = {
  name: string;
  description: string | null;
  priceCents: number;
  emoji: string;
  images: string[];
  imageUrl: string | null;
  productType: string | null;
  condition: string | null;
  rarity: string | null;
  vendorProductId: string | null;
};

/**
 * Save the new (not library-sourced) items from a drop into the vendor's
 * reusable product library, so they don't have to recreate them next time.
 * Matches an existing library item by name (case-insensitive) and refreshes it;
 * otherwise creates one. Best-effort — never blocks the drop save.
 */
async function saveProductsToLibrary(sellerId: string, rows: LibRow[]) {
  const existing = await prisma.vendorProduct.findMany({
    where: { sellerId },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.id]));
  for (const r of rows) {
    if (r.vendorProductId) continue; // already came from the library
    const key = r.name.trim().toLowerCase();
    if (!key) continue;
    const data = {
      name: r.name,
      description: r.description,
      priceCents: r.priceCents,
      emoji: r.emoji,
      images: r.images,
      imageUrl: r.imageUrl,
      productType: r.productType,
      condition: r.condition,
      rarity: r.rarity,
    };
    try {
      const id = byName.get(key);
      if (id) {
        await prisma.vendorProduct.update({ where: { id }, data });
      } else {
        const created = await prisma.vendorProduct.create({ data: { sellerId, ...data } });
        byName.set(key, created.id); // dedupe repeats within the same submission
      }
    } catch (e) {
      console.error("saveProductsToLibrary failed for", r.name, e);
    }
  }
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
  const requested = liveMode || statusRaw === "live" ? "live" : "draft";
  // Stripe gate: a vendor who can't take payment can still build the drop, but
  // it is saved as a draft rather than published. Nothing they entered is lost.
  const { status, blocked: stripeBlocked } = resolveDropStatus(requested, "draft", seller);

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
  const vpids = formData.getAll("p_vpid").map(String);

  const products = names
    .map((name, i) => {
      // Photos for this row arrive pre-uploaded as URLs in p_img_<i>.
      const imgs = formData.getAll(`p_img_${i}`).map(String).filter(Boolean);
      return {
        name: name.trim(),
        description: (descs[i] ?? "").trim() || null,
        priceCents: dollarsToCents(prices[i] ?? "0"),
        emoji: (emojis[i] ?? "🍪").trim() || "🍪",
        images: imgs,
        imageUrl: imgs[0] ?? null,
        inventory: Math.max(0, parseInt(invs[i] ?? "0", 10) || 0),
        sortOrder: i,
        productType: (types[i] ?? "").trim() || null,
        condition: (conditions[i] ?? "").trim() || null,
        rarity: (rarities[i] ?? "").trim() || null,
        vendorProductId: (vpids[i] ?? "").trim() || null,
      };
    })
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
      ...parsePickup(formData),
      products: { create: products },
    },
  });

  // Save new items to the vendor's library unless they opted out.
  if (formData.get("saveToLibrary") !== "off") {
    await saveProductsToLibrary(seller.id, products);
  }

  // Count it against the lifetime allowance (never decremented, so deleting a
  // drop doesn't refund a Starter slot).
  await prisma.seller.update({
    where: { id: seller.id },
    data: { dropsCreated: { increment: 1 } },
  });

  revalidatePath("/dashboard/drops");
  redirect(`/dashboard/drops/${drop.id}${stripeBlocked ? "?stripe_required=1" : ""}`);
}

// Full edit: updates the drop in place (never duplicates) and syncs its items.
export async function updateDropFullAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));
  const drop = await prisma.drop.findUnique({ where: { id: dropId }, include: { products: true } });
  if (!drop || drop.sellerId !== seller.id) return;

  const title = String(formData.get("title") ?? "").trim();
  const statusRaw = String(formData.get("status") ?? drop.status);
  // Stripe gate: publishing needs a charge-ready vendor. Taking a drop down
  // (live -> closed/draft) is always allowed — see resolveDropStatus.
  const { status, blocked: stripeBlocked } = resolveDropStatus(statusRaw, drop.status, seller);
  const opensAt = formData.get("opensAt") ? new Date(String(formData.get("opensAt"))) : drop.opensAt;
  const closesAt = formData.get("closesAt") ? new Date(String(formData.get("closesAt"))) : drop.closesAt;
  const pickup = parsePickup(formData);

  // Detect a pickup-detail change so we can notify customers who already ordered.
  const pickupChanged =
    drop.pickupStartAt?.getTime() !== pickup.pickupStartAt?.getTime() ||
    drop.pickupEndAt?.getTime() !== pickup.pickupEndAt?.getTime() ||
    (drop.pickupAddress ?? null) !== pickup.pickupAddress ||
    (drop.pickupLocationName ?? null) !== pickup.pickupLocationName ||
    (drop.pickupNotes ?? null) !== pickup.pickupNotes;

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
      ...pickup,
    },
  });

  // If pickup details changed and this drop already has orders, let those
  // customers know (email + SMS, best effort in the background).
  if (pickupChanged && (pickup.pickupStartAt || pickup.pickupAddress)) {
    after(() => notifyPickupChanged(dropId));
  }

  // Sync products (update existing, create new, delete removed)
  const ids = formData.getAll("p_id").map(String);
  const names = formData.getAll("p_name").map(String);
  const descs = formData.getAll("p_desc").map(String);
  const prices = formData.getAll("p_price").map(String);
  const emojis = formData.getAll("p_emoji").map(String);
  const invs = formData.getAll("p_inventory").map(String);
  const types = formData.getAll("p_type").map(String);
  const conditions = formData.getAll("p_condition").map(String);
  const rarities = formData.getAll("p_rarity").map(String);
  const vpids = formData.getAll("p_vpid").map(String);

  const newLibRows: LibRow[] = [];
  const submittedIds = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    // The editor pre-uploads photos and submits the full URL set (kept + new)
    // for each row as p_img_<i>, so we just persist it verbatim.
    const imgs = formData.getAll(`p_img_${i}`).map(String).filter(Boolean);
    const vendorProductId = (vpids[i] ?? "").trim() || null;
    const base = {
      name,
      description: (descs[i] ?? "").trim() || null,
      priceCents: dollarsToCents(prices[i] ?? "0"),
      emoji: (emojis[i] ?? "🍪").trim() || "🍪",
      images: imgs,
      imageUrl: imgs[0] ?? null,
      inventory: Math.max(0, parseInt(invs[i] ?? "0", 10) || 0),
      sortOrder: i,
      productType: (types[i] ?? "").trim() || null,
      condition: (conditions[i] ?? "").trim() || null,
      rarity: (rarities[i] ?? "").trim() || null,
      vendorProductId,
    };
    const id = ids[i];
    if (id) {
      submittedIds.add(id);
      // Scope to this drop so a crafted p_id can't overwrite another vendor's product.
      await prisma.product.updateMany({ where: { id, dropId }, data: base });
    } else {
      await prisma.product.create({ data: { ...base, dropId } });
      newLibRows.push(base);
    }
  }
  const removed = drop.products.filter((p) => !submittedIds.has(p.id)).map((p) => p.id);
  if (removed.length) await prisma.product.deleteMany({ where: { id: { in: removed }, dropId } });

  // Newly-added items (not from the library) get saved to it, unless opted out.
  if (newLibRows.length && formData.get("saveToLibrary") !== "off") {
    await saveProductsToLibrary(seller.id, newLibRows);
  }

  revalidatePath(`/dashboard/drops/${dropId}`);
  revalidatePath("/dashboard/drops");
  revalidatePath(`/s/${seller.slug}`);
  revalidatePath(`/s/${seller.slug}/${dropId}`);
  redirect(`/dashboard/drops/${dropId}${stripeBlocked ? "?stripe_required=1" : ""}`);
}

export async function updateDropStatusAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));
  const statusRaw = String(formData.get("status"));
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop || drop.sellerId !== seller.id) return;
  // Whitelist + Stripe gate. This action used to write the raw form value, so
  // any string at all could land in Drop.status.
  const { status, blocked: stripeBlocked } = resolveDropStatus(statusRaw, drop.status, seller);
  if (stripeBlocked) {
    redirect(`/dashboard/drops/${dropId}?stripe_required=1`);
  }
  if (status === drop.status) return;
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

/**
 * Relaunch / duplicate a past drop into a fresh draft. Copies content (title,
 * description, items + photos, prices, pickup location/notes/find-me) but NOT
 * the schedule, orders, sales, or sold counts — the vendor sets new dates and
 * publishes. Opens the editor with the copy.
 */
export async function duplicateDropAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));

  // A relaunch is a new drop — respect the Starter lifetime limit like create.
  if (!canCreateDrop(seller)) redirect("/dashboard/billing?limit=1");

  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: { products: { orderBy: { sortOrder: "asc" } } },
  });
  if (!drop || drop.sellerId !== seller.id) return;

  const copy = await prisma.drop.create({
    data: {
      sellerId: seller.id,
      title: drop.title,
      description: drop.description,
      mode: drop.mode === "live" ? "live" : "preorder",
      status: "draft", // always a draft — vendor sets new dates before publishing
      fulfillment: drop.fulfillment,
      pickupInfo: drop.pickupInfo,
      // Deliberately NOT copied: opensAt, closesAt, pickupStartAt, pickupEndAt,
      // orders, sales, vendorArrivedAt.
      pickupLocationName: drop.pickupLocationName,
      pickupAddress: drop.pickupAddress,
      pickupLat: drop.pickupLat,
      pickupLng: drop.pickupLng,
      pickupNotes: drop.pickupNotes,
      pickupFindMe: drop.pickupFindMe,
      pickupLine1: drop.pickupLine1,
      pickupCity: drop.pickupCity,
      pickupState: drop.pickupState,
      pickupPostal: drop.pickupPostal,
      pickupCountry: drop.pickupCountry,
      products: {
        create: drop.products.map((p) => ({
          vendorProductId: p.vendorProductId,
          name: p.name,
          description: p.description,
          priceCents: p.priceCents,
          emoji: p.emoji,
          imageUrl: p.imageUrl,
          images: p.images,
          inventory: p.inventory,
          sold: 0, // reset — fresh drop
          sortOrder: p.sortOrder,
          productType: p.productType,
          condition: p.condition,
          rarity: p.rarity,
        })),
      },
    },
  });

  await prisma.seller.update({
    where: { id: seller.id },
    data: { dropsCreated: { increment: 1 } },
  });

  revalidatePath("/dashboard/drops");
  redirect(`/dashboard/drops/${copy.id}/edit?copied=1`);
}

/** Email + text customers with an active order that the vendor has arrived. */
async function notifyVendorArrived(dropId: string) {
  const drop = await prisma.drop.findUnique({
    where: { id: dropId },
    include: { seller: true },
  });
  if (!drop) return;
  const orders = await prisma.order.findMany({
    where: { dropId, status: { in: ["new", "in_progress", "ready"] } },
    select: { id: true, buyerEmail: true, buyerPhone: true,
      customerId: true, buyerName: true },
  });
  if (!orders.length) return;

  const store = drop.seller.storeName;
  const mapsUrl = dropMapsUrl(drop);
  const where = pickupLocation(drop);
  const base = await baseUrl();
  const mailPickup = orderMailPickup(drop, drop.seller);

  for (const o of orders) {
    const first = o.buyerName.split(" ")[0] || o.buyerName;
    const orderLink = `${base}/order/${o.id}`;
    try {
      await sendEmail(
        vendorArrivedEmail({
          to: o.buyerEmail,
          storeName: store,
          buyerFirst: first,
          orderLink,
          dropTitle: drop.title,
          ...mailPickup,
        })
      );
      await sendGatedSms({
        kind: "transactional",
        customerId: o.customerId,
        email: o.buyerEmail,
        to: o.buyerPhone,
        body:
          `${store} has arrived and is ready for you! ${where ? `${where}. ` : ""}` +
          `${mapsUrl ? `Directions: ${mapsUrl} ` : ""}Your order: ${orderLink}`,
      });
    } catch (e) {
      console.error("notifyVendorArrived send failed:", e);
    }
  }
}

/** Vendor check-in at the pickup location → broadcasts to waiting customers. */
export async function vendorArrivedAction(formData: FormData) {
  const seller = await requireSeller();
  const dropId = String(formData.get("dropId"));
  const drop = await prisma.drop.findUnique({ where: { id: dropId } });
  if (!drop || drop.sellerId !== seller.id) return;

  // Idempotent: only the first check-in broadcasts.
  if (!drop.vendorArrivedAt) {
    await prisma.drop.update({ where: { id: dropId }, data: { vendorArrivedAt: new Date() } });
    after(() => notifyVendorArrived(dropId));
  }
  revalidatePath(`/dashboard/drops/${dropId}`);
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
    include: { drop: true },
  });
  if (!order || order.sellerId !== seller.id) return;

  const prev = order.status;
  if (status === prev) return;

  await prisma.order.update({
    where: { id: orderId },
    data: { status, events: { create: { type: "status", detail: status } } },
  });

  // Canceling a paid order implies a refund → void any un-paid sales-rep
  // commission for it (paid commissions are left for a manual adjustment).
  if (status === "canceled") {
    await voidCommissionForOrder(orderId, "Order canceled by vendor");
  }

  // Text (+ email) the customer when their order status changes.
  {
    const link = `${await baseUrl()}/order/${order.id}`;
    const first = order.buyerName.split(" ")[0] || order.buyerName;
    const store = seller.storeName;
    const isPickup = (order.drop.fulfillment ?? "pickup") === "pickup";
    let sms: string | null = null;
    let mail: Parameters<typeof sendEmail>[0] | null = null;
    // Shared recipient/context for every status email — branded as the vendor,
    // with full pickup details (window, address, maps, how-to-find, contact).
    const mailArgs = {
      to: order.buyerEmail,
      storeName: store,
      buyerFirst: first,
      orderLink: link,
      ...orderMailPickup(order.drop, seller),
    };

    if (status === "in_progress") {
      sms = `${store}: We're preparing your order now, ${first}! We'll let you know the moment it's ready. ${link}`;
      mail = orderInProgressEmail(mailArgs);
    } else if (status === "ready") {
      const where = pickupLocation(order.drop);
      const mapsUrl = dropMapsUrl(order.drop);
      sms =
        `${store}: Your order is ready${isPickup ? " for pickup" : ""}! 🎉` +
        (where ? ` ${where}.` : "") +
        (mapsUrl ? ` Directions: ${mapsUrl}` : "") +
        ` ${link}`;
      mail = orderReadyEmail(mailArgs);
    } else if (status === "completed") {
      sms = `${store}: Thanks for your order, ${first}! 🙌 See you at the next drop.`;
      mail = orderCompletedEmail(mailArgs);
    } else if (status === "canceled") {
      sms = `${store}: Your order was canceled. Reach out to the maker with any questions.`;
      mail = orderCanceledEmail(mailArgs);
    }

    if (sms || mail) {
      after(async () => {
        if (mail) await sendEmail(mail);
        if (sms) await sendGatedSms({ kind: "transactional", body: sms, customerId: order.customerId, email: order.buyerEmail, to: order.buyerPhone });
      });
    }
  }

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/drops/${order.dropId}`);
  revalidatePath("/dashboard");
}
