"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSeller, getCurrentSeller, requireAdmin, getCurrentAdmin } from "@/lib/auth";
import { getCurrentCustomer, requireCustomer } from "@/lib/customer-auth";
import { geocode } from "@/lib/geofence";
import { activeRegion, validateInRegion } from "@/lib/dropmeet/geo";
import { findLocationDuplicates, findMarketDuplicates, uniqueSlug } from "@/lib/dropmeet/dedupe";
import { LOCATION_TYPES, MARKET_TYPES } from "@/lib/dropmeet/types";

/**
 * DropMeet writes.
 *
 * Two rules are enforced here and cannot be bypassed from any client:
 *   1. Nothing a member of the public submits is ever created as "approved".
 *      Submissions land as `pending` and stay invisible until an admin acts.
 *   2. Every coordinate is validated against the region polygon server-side,
 *      regardless of what the browser claimed.
 */

export type SubmitState = { ok?: boolean; error?: string; slug?: string; pending?: boolean };
export type AppearanceState = { ok?: boolean; error?: string };
export type SimpleState = { ok?: boolean; error?: string };

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function optional(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

/** Who is submitting — either principal may, but they must be signed in. */
async function currentSubmitter() {
  const seller = await getCurrentSeller();
  if (seller) return { sellerId: seller.id, customerId: null as string | null };
  const customer = await getCurrentCustomer();
  if (customer) return { sellerId: null as string | null, customerId: customer.id };
  return null;
}

/**
 * Resolve an address to coordinates. Prefers coordinates the client already
 * captured from the autocomplete (saves a Nominatim call and is more accurate),
 * but never trusts them for the region check — that runs regardless.
 */
async function resolveCoords(fd: FormData, address: string) {
  const rawLat = parseFloat(str(fd, "latitude"));
  const rawLng = parseFloat(str(fd, "longitude"));
  if (Number.isFinite(rawLat) && Number.isFinite(rawLng)) return { lat: rawLat, lng: rawLng };
  const geo = await geocode(address);
  return geo ? { lat: geo.lat, lng: geo.lng } : null;
}

// ── Community submissions ──────────────────────────────────────────────────

export async function submitLocationAction(
  _prev: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const who = await currentSubmitter();
  if (!who) return { error: "Sign in to add a place." };

  const region = await activeRegion();
  if (!region) return { error: "DropMeet isn't open in your area yet." };

  const name = str(formData, "name");
  const address = str(formData, "address");
  const locationType = str(formData, "locationType") || "other";

  if (name.length < 2) return { error: "Give the place a name." };
  if (!address) return { error: "Add a street address so people can find it." };
  if (!(locationType in LOCATION_TYPES)) return { error: "Pick a category." };

  const coords = await resolveCoords(formData, address);
  if (!coords) {
    return { error: "We couldn't find that address. Try adding the city and ZIP." };
  }

  // The gate. Server-side, always.
  const check = await validateInRegion(coords.lat, coords.lng, region.slug);
  if (!check.ok) return { error: check.message };

  const slug = await uniqueSlug(name, "location");

  try {
    await prisma.location.create({
      data: {
        regionId: region.id,
        name,
        slug,
        locationType,
        description: optional(formData, "description"),
        address,
        city: optional(formData, "city"),
        state: optional(formData, "state") ?? "CA",
        postalCode: optional(formData, "postalCode"),
        latitude: coords.lat,
        longitude: coords.lng,
        websiteUrl: optional(formData, "websiteUrl"),
        instagramUrl: optional(formData, "instagramUrl"),
        facebookUrl: optional(formData, "facebookUrl"),
        phone: optional(formData, "phone"),
        imageUrl: optional(formData, "imageUrl"),
        // Explicitly pending. There is no branch of this function that approves.
        status: "pending",
        verificationStatus: "community_submitted",
        sourceType: "community_submission",
        submittedBySellerId: who.sellerId,
        submittedByCustomerId: who.customerId,
        reviewNotes: optional(formData, "notes"),
      },
    });
  } catch (e) {
    console.error("submitLocationAction failed:", e);
    return { error: "Couldn't save that place. Please try again." };
  }

  revalidatePath("/admin/dropmeet");
  return { ok: true, pending: true, slug };
}

export async function submitMarketAction(
  _prev: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const who = await currentSubmitter();
  if (!who) return { error: "Sign in to add a market." };

  const region = await activeRegion();
  if (!region) return { error: "DropMeet isn't open in your area yet." };

  const name = str(formData, "name");
  const marketType = str(formData, "marketType") || "other";
  const existingLocationId = optional(formData, "locationId");

  if (name.length < 2) return { error: "Give the market a name." };
  if (!(marketType in MARKET_TYPES)) return { error: "Pick a market type." };

  let locationId = existingLocationId;

  if (locationId) {
    // A market may only attach to a location that is already public.
    const loc = await prisma.location.findFirst({
      where: { id: locationId, regionId: region.id, status: "approved" },
      select: { id: true },
    });
    if (!loc) return { error: "Pick a location from the list." };
  } else {
    // No existing location — create one alongside, also pending.
    const address = str(formData, "address");
    if (!address) return { error: "Add the market's address." };

    const coords = await resolveCoords(formData, address);
    if (!coords) return { error: "We couldn't find that address. Try adding the city and ZIP." };

    const check = await validateInRegion(coords.lat, coords.lng, region.slug);
    if (!check.ok) return { error: check.message };

    const locSlug = await uniqueSlug(name, "location");
    const created = await prisma.location.create({
      data: {
        regionId: region.id,
        name,
        slug: locSlug,
        locationType: "market",
        address,
        city: optional(formData, "city"),
        state: optional(formData, "state") ?? "CA",
        postalCode: optional(formData, "postalCode"),
        latitude: coords.lat,
        longitude: coords.lng,
        status: "pending",
        verificationStatus: "community_submitted",
        sourceType: "community_submission",
        submittedBySellerId: who.sellerId,
        submittedByCustomerId: who.customerId,
      },
    });
    locationId = created.id;
  }

  const slug = await uniqueSlug(name, "market");

  try {
    const market = await prisma.market.create({
      data: {
        regionId: region.id,
        locationId: locationId!,
        name,
        slug,
        marketType,
        description: optional(formData, "description"),
        websiteUrl: optional(formData, "websiteUrl"),
        instagramUrl: optional(formData, "instagramUrl"),
        organizerName: optional(formData, "organizerName"),
        organizerEmail: optional(formData, "organizerEmail"),
        status: "pending",
        verificationStatus: "community_submitted",
        sourceType: "community_submission",
        submittedBySellerId: who.sellerId,
        submittedByCustomerId: who.customerId,
        reviewNotes: optional(formData, "notes"),
      },
    });

    // Optional structured schedule captured at submission time.
    const dayOfWeek = parseInt(str(formData, "dayOfWeek"), 10);
    const startTime = str(formData, "startTime");
    const endTime = str(formData, "endTime");
    if (Number.isFinite(dayOfWeek) && dayOfWeek >= 0 && dayOfWeek <= 6 && startTime && endTime) {
      await prisma.marketSchedule.create({
        data: {
          marketId: market.id,
          recurrence: str(formData, "recurrence") || "weekly",
          dayOfWeek,
          startTime,
          endTime,
        },
      });
    }
  } catch (e) {
    console.error("submitMarketAction failed:", e);
    return { error: "Couldn't save that market. Please try again." };
  }

  revalidatePath("/admin/dropmeet");
  return { ok: true, pending: true, slug };
}

// ── Vendor appearances ─────────────────────────────────────────────────────

export async function createAppearanceAction(
  _prev: AppearanceState,
  formData: FormData
): Promise<AppearanceState> {
  const seller = await requireSeller();

  const marketId = optional(formData, "marketId");
  const locationId = optional(formData, "locationId");
  const eventId = optional(formData, "eventId");
  const dropId = optional(formData, "dropId");
  const date = str(formData, "date");
  const startTime = str(formData, "startTime");
  const endTime = str(formData, "endTime");

  if (!marketId && !locationId && !eventId) return { error: "Pick where you'll be." };
  if (!date || !startTime) return { error: "Pick a date and start time." };

  // A vendor may only attach to places the public can actually see. This is
  // what stops someone self-publishing via an unapproved submission.
  if (marketId) {
    const ok = await prisma.market.findFirst({ where: { id: marketId, status: "approved" }, select: { id: true } });
    if (!ok) return { error: "That market isn't available yet." };
  }
  if (locationId) {
    const ok = await prisma.location.findFirst({ where: { id: locationId, status: "approved" }, select: { id: true } });
    if (!ok) return { error: "That location isn't available yet." };
  }
  if (eventId) {
    const ok = await prisma.event.findFirst({ where: { id: eventId, status: "approved" }, select: { id: true } });
    if (!ok) return { error: "That event isn't available yet." };
  }

  // A vendor may only attach their *own* drop.
  if (dropId) {
    const owned = await prisma.drop.findFirst({
      where: { id: dropId, sellerId: seller.id },
      select: { id: true },
    });
    if (!owned) return { error: "That drop isn't yours." };
  }

  const start = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(start.getTime())) return { error: "That date doesn't look right." };
  const end = endTime ? new Date(`${date}T${endTime}:00`) : null;
  if (end && end.getTime() <= start.getTime()) return { error: "End time must be after the start." };

  try {
    await prisma.vendorAppearance.create({
      data: {
        sellerId: seller.id,
        marketId,
        locationId,
        eventId,
        dropId,
        startDateTime: start,
        endDateTime: end,
        boothInfo: optional(formData, "boothInfo"),
        notes: optional(formData, "notes"),
        status: "scheduled",
      },
    });
  } catch (e) {
    console.error("createAppearanceAction failed:", e);
    return { error: "Couldn't save that appearance. Please try again." };
  }

  revalidatePath("/dashboard/where-ill-be");
  revalidatePath("/dropmeet");
  return { ok: true };
}

export async function updateAppearanceAction(
  _prev: AppearanceState,
  formData: FormData
): Promise<AppearanceState> {
  const seller = await requireSeller();
  const id = str(formData, "appearanceId");

  // Ownership is the query — a vendor cannot touch another vendor's appearance.
  const owned = await prisma.vendorAppearance.findFirst({
    where: { id, sellerId: seller.id },
    select: { id: true },
  });
  if (!owned) return { error: "Appearance not found." };

  const dropId = optional(formData, "dropId");
  if (dropId) {
    const ownedDrop = await prisma.drop.findFirst({
      where: { id: dropId, sellerId: seller.id },
      select: { id: true },
    });
    if (!ownedDrop) return { error: "That drop isn't yours." };
  }

  const date = str(formData, "date");
  const startTime = str(formData, "startTime");
  const endTime = str(formData, "endTime");
  const start = date && startTime ? new Date(`${date}T${startTime}:00`) : null;
  if (start && Number.isNaN(start.getTime())) return { error: "That date doesn't look right." };

  try {
    await prisma.vendorAppearance.update({
      where: { id },
      data: {
        dropId,
        ...(start ? { startDateTime: start } : {}),
        ...(date && endTime ? { endDateTime: new Date(`${date}T${endTime}:00`) } : {}),
        boothInfo: optional(formData, "boothInfo"),
        notes: optional(formData, "notes"),
      },
    });
  } catch (e) {
    console.error("updateAppearanceAction failed:", e);
    return { error: "Couldn't update that appearance." };
  }

  revalidatePath("/dashboard/where-ill-be");
  return { ok: true };
}

export async function cancelAppearanceAction(formData: FormData): Promise<void> {
  const seller = await requireSeller();
  const id = str(formData, "appearanceId");
  // updateMany with the ownership predicate: a mismatched id updates 0 rows.
  await prisma.vendorAppearance.updateMany({
    where: { id, sellerId: seller.id },
    data: { status: "cancelled" },
  });
  revalidatePath("/dashboard/where-ill-be");
  revalidatePath("/dropmeet");
}

// ── Follows ────────────────────────────────────────────────────────────────

export async function toggleLocationFollowAction(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const locationId = str(formData, "locationId");
  const slug = str(formData, "slug");

  const existing = await prisma.locationFollow.findUnique({
    where: { customerId_locationId: { customerId: customer.id, locationId } },
  });
  if (existing) {
    await prisma.locationFollow.delete({ where: { id: existing.id } });
  } else {
    const open = await prisma.location.findFirst({
      where: { id: locationId, status: "approved" },
      select: { id: true },
    });
    if (open) {
      await prisma.locationFollow.create({ data: { customerId: customer.id, locationId } });
    }
  }
  if (slug) revalidatePath(`/dropmeet/locations/${slug}`);
}

export async function toggleMarketFollowAction(formData: FormData): Promise<void> {
  const customer = await requireCustomer();
  const marketId = str(formData, "marketId");
  const slug = str(formData, "slug");

  const existing = await prisma.marketFollow.findUnique({
    where: { customerId_marketId: { customerId: customer.id, marketId } },
  });
  if (existing) {
    await prisma.marketFollow.delete({ where: { id: existing.id } });
  } else {
    const open = await prisma.market.findFirst({
      where: { id: marketId, status: "approved" },
      select: { id: true },
    });
    if (open) {
      await prisma.marketFollow.create({ data: { customerId: customer.id, marketId } });
    }
  }
  if (slug) revalidatePath(`/dropmeet/markets/${slug}`);
}

// ── Claims and leads ───────────────────────────────────────────────────────

export async function submitClaimAction(
  _prev: SimpleState,
  formData: FormData
): Promise<SimpleState> {
  const entityType = str(formData, "entityType");
  const locationId = optional(formData, "locationId");
  const marketId = optional(formData, "marketId");
  const name = str(formData, "name");
  const email = str(formData, "email");

  if (!name || !email) return { error: "Add your name and email." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email doesn't look right." };
  if (entityType !== "location" && entityType !== "market") return { error: "Something went wrong." };

  const seller = await getCurrentSeller();

  try {
    await prisma.claimRequest.create({
      data: {
        entityType,
        locationId,
        marketId,
        name,
        email,
        role: optional(formData, "role"),
        organization: optional(formData, "organization"),
        message: optional(formData, "message"),
        claimantSellerId: seller?.id ?? null,
        // Claiming grants nothing. An admin decides.
        status: "pending",
      },
    });
  } catch (e) {
    console.error("submitClaimAction failed:", e);
    return { error: "Couldn't send that. Please try again." };
  }

  revalidatePath("/admin/dropmeet");
  return { ok: true };
}

export async function submitVendorLeadAction(
  _prev: SimpleState,
  formData: FormData
): Promise<SimpleState> {
  const businessName = str(formData, "businessName");
  if (businessName.length < 2) return { error: "Add the vendor's name." };

  try {
    await prisma.vendorLead.create({
      data: {
        locationId: optional(formData, "locationId"),
        marketId: optional(formData, "marketId"),
        businessName,
        website: optional(formData, "website"),
        email: optional(formData, "email"),
        phone: optional(formData, "phone"),
        submitterEmail: optional(formData, "submitterEmail"),
      },
    });
  } catch (e) {
    console.error("submitVendorLeadAction failed:", e);
    return { error: "Couldn't send that. Please try again." };
  }

  return { ok: true };
}

// ── Admin moderation ───────────────────────────────────────────────────────

/**
 * Approve a submitted place. Admin-only, and the *only* path by which a
 * Location or Market becomes publicly visible. Re-runs the region check on the
 * final coordinates, because an admin may have corrected the address.
 */
export async function approveLocationAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(formData, "id");

  const loc = await prisma.location.findUnique({ where: { id } });
  if (!loc) return;

  const check = await validateInRegion(loc.latitude, loc.longitude);
  if (!check.ok) {
    await prisma.location.update({
      where: { id },
      data: { status: "needs_information", reviewNotes: check.message },
    });
    revalidatePath("/admin/dropmeet");
    return;
  }

  await prisma.location.update({
    where: { id },
    data: {
      status: "approved",
      approvedByAdminId: admin.id,
      approvedAt: new Date(),
      rejectedAt: null,
      rejectionReason: null,
      lastVerifiedAt: new Date(),
    },
  });

  revalidatePath("/admin/dropmeet");
  revalidatePath("/dropmeet");
}

export async function rejectLocationAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(formData, "id");
  await prisma.location.update({
    where: { id },
    data: {
      status: str(formData, "status") === "duplicate" ? "duplicate" : "rejected",
      duplicateOfId: optional(formData, "duplicateOfId"),
      rejectedAt: new Date(),
      rejectionReason: optional(formData, "reason"),
      approvedByAdminId: admin.id,
    },
  });
  revalidatePath("/admin/dropmeet");
  revalidatePath("/dropmeet");
}

/** Admins may correct a submission before approving it. */
export async function editLocationAction(
  _prev: SimpleState,
  formData: FormData
): Promise<SimpleState> {
  await requireAdmin();
  const id = str(formData, "id");
  const address = str(formData, "address");

  const data: Record<string, unknown> = {
    name: str(formData, "name"),
    locationType: str(formData, "locationType") || "other",
    description: optional(formData, "description"),
    address,
    city: optional(formData, "city"),
    state: optional(formData, "state"),
    postalCode: optional(formData, "postalCode"),
    websiteUrl: optional(formData, "websiteUrl"),
    instagramUrl: optional(formData, "instagramUrl"),
    phone: optional(formData, "phone"),
    verificationStatus: str(formData, "verificationStatus") || "community_submitted",
  };

  // Re-geocode when the admin changed the address, then re-validate.
  const lat = parseFloat(str(formData, "latitude"));
  const lng = parseFloat(str(formData, "longitude"));
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const check = await validateInRegion(lat, lng);
    if (!check.ok) return { error: check.message };
    data.latitude = lat;
    data.longitude = lng;
  }

  try {
    await prisma.location.update({ where: { id }, data });
  } catch (e) {
    console.error("editLocationAction failed:", e);
    return { error: "Couldn't save those changes." };
  }

  revalidatePath("/admin/dropmeet");
  return { ok: true };
}

export async function approveMarketAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(formData, "id");

  const market = await prisma.market.findUnique({
    where: { id },
    select: { id: true, locationId: true, location: { select: { status: true } } },
  });
  if (!market) return;

  // A market can't be public while its location isn't — approve the pair.
  if (market.location.status !== "approved") {
    const loc = await prisma.location.findUnique({ where: { id: market.locationId } });
    if (loc) {
      const check = await validateInRegion(loc.latitude, loc.longitude);
      if (!check.ok) {
        await prisma.market.update({
          where: { id },
          data: { status: "needs_information", reviewNotes: check.message },
        });
        revalidatePath("/admin/dropmeet");
        return;
      }
      await prisma.location.update({
        where: { id: loc.id },
        data: { status: "approved", approvedByAdminId: admin.id, approvedAt: new Date() },
      });
    }
  }

  await prisma.market.update({
    where: { id },
    data: {
      status: "approved",
      approvedByAdminId: admin.id,
      approvedAt: new Date(),
      rejectedAt: null,
      rejectionReason: null,
      lastVerifiedAt: new Date(),
    },
  });

  revalidatePath("/admin/dropmeet");
  revalidatePath("/dropmeet");
}

export async function rejectMarketAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(formData, "id");
  await prisma.market.update({
    where: { id },
    data: {
      status: str(formData, "status") === "duplicate" ? "duplicate" : "rejected",
      duplicateOfId: optional(formData, "duplicateOfId"),
      rejectedAt: new Date(),
      rejectionReason: optional(formData, "reason"),
      approvedByAdminId: admin.id,
    },
  });
  revalidatePath("/admin/dropmeet");
  revalidatePath("/dropmeet");
}

export async function reviewClaimAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(formData, "id");
  const approve = str(formData, "decision") === "approve";

  const claim = await prisma.claimRequest.findUnique({ where: { id } });
  if (!claim) return;

  await prisma.claimRequest.update({
    where: { id },
    data: {
      status: approve ? "approved" : "rejected",
      reviewedByAdminId: admin.id,
      reviewedAt: new Date(),
      reviewNotes: optional(formData, "notes"),
    },
  });

  // Approval marks the market as organizer-managed. It does not hand over edit
  // rights — the organizer portal is deliberately not built yet.
  if (approve && claim.marketId && claim.claimantSellerId) {
    await prisma.market.update({
      where: { id: claim.marketId },
      data: {
        isClaimed: true,
        claimedBySellerId: claim.claimantSellerId,
        claimedAt: new Date(),
        verificationStatus: "organizer_claimed",
      },
    });
  }

  revalidatePath("/admin/dropmeet");
}

/** Duplicate suggestions for one pending record, for the review card. */
export async function duplicatesForLocationAction(id: string) {
  const admin = await getCurrentAdmin();
  if (!admin) return [];
  const loc = await prisma.location.findUnique({ where: { id } });
  if (!loc) return [];
  return findLocationDuplicates(
    {
      name: loc.name,
      latitude: loc.latitude,
      longitude: loc.longitude,
      address: loc.address,
      websiteUrl: loc.websiteUrl,
      phone: loc.phone,
    },
    loc.regionId,
    loc.id
  );
}

export async function duplicatesForMarketAction(id: string) {
  const admin = await getCurrentAdmin();
  if (!admin) return [];
  const market = await prisma.market.findUnique({ where: { id } });
  if (!market) return [];
  return findMarketDuplicates(
    { name: market.name, locationId: market.locationId, websiteUrl: market.websiteUrl },
    market.regionId,
    market.id
  );
}

/** Admin-authored place, created already approved. Their own entry path. */
export async function adminCreateLocationAction(
  _prev: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const admin = await requireAdmin();
  const region = await activeRegion();
  if (!region) return { error: "Seed a region first (npm run db:seed-region)." };

  const name = str(formData, "name");
  const address = str(formData, "address");
  if (name.length < 2) return { error: "Give the place a name." };
  if (!address) return { error: "Add the address." };

  const coords = await resolveCoords(formData, address);
  if (!coords) return { error: "We couldn't geocode that address." };

  const check = await validateInRegion(coords.lat, coords.lng, region.slug);
  if (!check.ok) return { error: check.message };

  const slug = await uniqueSlug(name, "location");
  await prisma.location.create({
    data: {
      regionId: region.id,
      name,
      slug,
      locationType: str(formData, "locationType") || "other",
      description: optional(formData, "description"),
      address,
      city: optional(formData, "city"),
      state: optional(formData, "state") ?? "CA",
      postalCode: optional(formData, "postalCode"),
      latitude: coords.lat,
      longitude: coords.lng,
      websiteUrl: optional(formData, "websiteUrl"),
      instagramUrl: optional(formData, "instagramUrl"),
      phone: optional(formData, "phone"),
      status: "approved",
      verificationStatus: str(formData, "verificationStatus") || "verified",
      sourceType: str(formData, "sourceType") || "manual_research",
      sourceName: optional(formData, "sourceName"),
      sourceUrl: optional(formData, "sourceUrl"),
      approvedByAdminId: admin.id,
      approvedAt: new Date(),
      lastVerifiedAt: new Date(),
    },
  });

  revalidatePath("/admin/dropmeet");
  revalidatePath("/dropmeet");
  redirect("/admin/dropmeet");
}
