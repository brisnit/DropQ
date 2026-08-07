import "server-only";
import { prisma } from "@/lib/db";
import { computeDropPhase, isOrderingOpen } from "@/lib/drop-status";
import { followedVendors } from "@/lib/attribution";
import { orderStatusLabel } from "@/lib/orders";

/**
 * The read layer behind My DropQ.
 *
 * Every query is scoped by customerId — a customer only ever sees their own
 * orders, follows and history. Drop status is decided by the existing rules
 * (computeDropPhase / isOrderingOpen) rather than a parallel notion of
 * "active", so a drop that's closed for orders can't show a Preorder button
 * here while showing something different on the storefront.
 */

/** Statuses that mean "this order is still going to happen". */
const ACTIVE = ["new", "in_progress", "ready"];
const DONE = ["completed", "fulfilled", "canceled"];

const ORDER_INCLUDE = {
  items: true,
  drop: {
    select: {
      id: true,
      title: true,
      pickupStartAt: true,
      pickupEndAt: true,
      pickupLocationName: true,
      pickupAddress: true,
      fulfillment: true,
      products: { select: { imageUrl: true }, take: 1 },
    },
  },
  seller: {
    select: { id: true, slug: true, storeName: true, logoUrl: true, accent: true, category: true },
  },
} as const;

export async function activeOrders(customerId: string) {
  return prisma.order.findMany({
    where: { customerId, status: { in: ACTIVE } },
    orderBy: { createdAt: "desc" },
    include: ORDER_INCLUDE,
  });
}

export async function pastOrders(customerId: string, take = 50) {
  return prisma.order.findMany({
    where: { customerId, status: { in: DONE } },
    orderBy: { createdAt: "desc" },
    take,
    include: ORDER_INCLUDE,
  });
}

/** One order, scoped — another customer's id returns null, not someone's receipt. */
export async function customerOrder(customerId: string, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, customerId },
    include: {
      ...ORDER_INCLUDE,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
}

export type CustomerOrder = NonNullable<Awaited<ReturnType<typeof customerOrder>>>;
export type OrderCard = Awaited<ReturnType<typeof activeOrders>>[number];

/** First product photo on the drop — the closest thing we have to drop artwork. */
export function dropImage(o: { drop: { products: { imageUrl: string | null }[] } }): string | null {
  return o.drop.products[0]?.imageUrl ?? null;
}

/**
 * Live and upcoming drops from vendors this customer follows. The reason to
 * follow someone is to find out when they drop, so this is the payoff.
 */
export async function upcomingFromFollowed(customerId: string, take = 12) {
  const follows = await prisma.customerVendor.findMany({
    where: { customerId, followedAt: { not: null } },
    select: { sellerId: true },
  });
  const sellerIds = follows.map((f) => f.sellerId);
  if (sellerIds.length === 0) return [];

  const drops = await prisma.drop.findMany({
    where: {
      sellerId: { in: sellerIds },
      status: "live",
      seller: { disabledAt: null },
      OR: [{ closesAt: null }, { closesAt: { gte: new Date() } }],
    },
    orderBy: [{ opensAt: "asc" }, { createdAt: "desc" }],
    take,
    include: {
      seller: { select: { id: true, slug: true, storeName: true, logoUrl: true, accent: true } },
      products: { select: { imageUrl: true }, take: 1 },
      _count: { select: { products: true } },
    },
  });

  const now = new Date();
  return drops.map((d) => ({
    id: d.id,
    title: d.title,
    href: `/s/${d.seller.slug}/${d.id}`,
    image: d.products[0]?.imageUrl ?? null,
    seller: d.seller,
    phase: computeDropPhase(d, now),
    canOrder: isOrderingOpen(d, now),
    opensAt: d.opensAt,
    closesAt: d.closesAt,
    itemCount: d._count.products,
  }));
}

export type UpcomingDrop = Awaited<ReturnType<typeof upcomingFromFollowed>>[number];

/** Vendors followed, with their next live drop if there is one. */
export async function followedVendorCards(customerId: string) {
  const rows = await followedVendors(customerId);
  if (rows.length === 0) return [];

  const live = await prisma.drop.findMany({
    where: { sellerId: { in: rows.map((r) => r.sellerId) }, status: "live" },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, sellerId: true },
  });
  const liveBySeller = new Map(live.map((d) => [d.sellerId, d]));

  return rows.map((r) => ({
    sellerId: r.sellerId,
    slug: r.seller.slug,
    storeName: r.seller.storeName,
    logoUrl: r.seller.logoUrl,
    category: r.seller.category,
    city: r.seller.publicCity ?? r.seller.location,
    orderCount: r.orderCount,
    liveDrop: liveBySeller.get(r.sellerId) ?? null,
  }));
}

export type FollowedVendorCard = Awaited<ReturnType<typeof followedVendorCards>>[number];

/** Places and markets the customer saved in DropMeet. */
export async function savedPlaces(customerId: string) {
  const [locations, markets] = await Promise.all([
    prisma.locationFollow.findMany({
      where: { customerId, location: { status: "approved" } },
      orderBy: { createdAt: "desc" },
      include: {
        location: {
          select: { id: true, slug: true, name: true, city: true, imageUrl: true, locationType: true },
        },
      },
    }),
    prisma.marketFollow.findMany({
      where: { customerId, market: { status: "approved" } },
      orderBy: { createdAt: "desc" },
      include: {
        market: {
          select: {
            id: true,
            slug: true,
            name: true,
            imageUrl: true,
            marketType: true,
            location: { select: { city: true } },
          },
        },
      },
    }),
  ]);

  return {
    locations: locations.map((l) => ({
      id: l.location.id,
      name: l.location.name,
      href: `/dropmeet/locations/${l.location.slug}`,
      city: l.location.city,
      imageUrl: l.location.imageUrl,
      type: l.location.locationType,
    })),
    markets: markets.map((m) => ({
      id: m.market.id,
      name: m.market.name,
      href: `/dropmeet/markets/${m.market.slug}`,
      city: m.market.location.city,
      imageUrl: m.market.imageUrl,
      type: m.market.marketType,
    })),
  };
}

/** Drops the customer bookmarked, newest first. */
export async function savedDrops(customerId: string) {
  const rows = await prisma.savedDrop.findMany({
    where: { customerId, drop: { seller: { disabledAt: null } } },
    orderBy: { createdAt: "desc" },
    include: {
      drop: {
        select: {
          id: true,
          title: true,
          status: true,
          opensAt: true,
          closesAt: true,
          mode: true,
          products: { select: { imageUrl: true }, take: 1 },
          seller: { select: { id: true, slug: true, storeName: true, logoUrl: true } },
        },
      },
    },
  });

  const now = new Date();
  return rows.map((r) => ({
    id: r.drop.id,
    title: r.drop.title,
    href: `/s/${r.drop.seller.slug}/${r.drop.id}`,
    image: r.drop.products[0]?.imageUrl ?? null,
    seller: r.drop.seller,
    // A saved drop is only worth acting on while it's actually orderable.
    canOrder: r.drop.status === "live" && isOrderingOpen({ ...r.drop }, now),
    status: r.drop.status,
    closesAt: r.drop.closesAt,
    savedAt: r.createdAt,
  }));
}

export type SavedDropCard = Awaited<ReturnType<typeof savedDrops>>[number];

/**
 * Drop History — every drop the customer took part in, as a collection rather
 * than a receipt list. Grouped by drop, because joining a drop is the thing
 * worth remembering, not the transaction.
 */
export async function dropHistory(customerId: string) {
  const orders = await prisma.order.findMany({
    where: { customerId, status: { notIn: ["pending", "canceled"] } },
    orderBy: { createdAt: "desc" },
    include: ORDER_INCLUDE,
  });

  const byDrop = new Map<
    string,
    {
      dropId: string;
      title: string;
      href: string;
      image: string | null;
      seller: OrderCard["seller"];
      date: Date;
      items: { name: string; quantity: number }[];
      totalCents: number;
      place: string | null;
    }
  >();

  for (const o of orders) {
    const existing = byDrop.get(o.dropId);
    if (existing) {
      existing.items.push(...o.items.map((i) => ({ name: i.name, quantity: i.quantity })));
      existing.totalCents += o.totalCents;
      continue;
    }
    byDrop.set(o.dropId, {
      dropId: o.dropId,
      title: o.drop.title,
      href: `/s/${o.seller.slug}/${o.dropId}`,
      image: dropImage(o),
      seller: o.seller,
      date: o.createdAt,
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
      totalCents: o.totalCents,
      place: o.drop.pickupLocationName ?? o.drop.pickupAddress ?? null,
    });
  }

  return [...byDrop.values()];
}

export type DropHistoryEntry = Awaited<ReturnType<typeof dropHistory>>[number];

/** Everything the hub home needs, in one round of parallel queries. */
export async function myDropQHome(customerId: string) {
  const [active, vendors, upcoming, saved, historyCount, unreadMessages] = await Promise.all([
    activeOrders(customerId),
    followedVendorCards(customerId),
    upcomingFromFollowed(customerId),
    savedPlaces(customerId),
    prisma.order.count({ where: { customerId, status: { notIn: ["pending", "canceled"] } } }),
    prisma.conversation.aggregate({ where: { customerId }, _sum: { customerUnread: true } }),
  ]);

  return {
    active,
    vendors,
    upcoming,
    saved,
    historyCount,
    unreadMessages: unreadMessages._sum.customerUnread ?? 0,
  };
}

/** Human status line for an order card. */
export function orderStatusLine(o: OrderCard): string {
  const label = orderStatusLabel(o.status);
  if (o.status === "ready") return "Ready for pickup";
  if (o.status === "in_progress") return "Being prepared";
  if (o.status === "new") return "Order received";
  return label;
}
