import { notFound } from "next/navigation";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateDropFullAction } from "@/lib/actions/dashboard";
import { DropEditor } from "@/components/drop-editor";
import { Section } from "@/components/dashboard-ui";
import { BackLink } from "@/components/back-link";

export const metadata = { title: "Edit drop — DropQ" };

// Pass the full ISO instant; the (client) date picker converts it to the
// vendor's local time for display, then re-emits a correct UTC instant on save.
function toIso(d: Date | null): string {
  return d ? new Date(d).toISOString() : "";
}

export default async function EditDropPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ copied?: string }>;
}) {
  const { id } = await params;
  const { copied } = await searchParams;
  const seller = await requireSeller();
  const drop = await prisma.drop.findUnique({
    where: { id },
    include: {
      products: {
        orderBy: { sortOrder: "asc" },
        // Order count per item so the editor can warn before a vendor removes
        // something customers have already bought — see lib/drop-items.ts.
        include: { _count: { select: { orderItems: true } } },
      },
    },
  });
  if (!drop || drop.sellerId !== seller.id) notFound();

  // Saved products the vendor can add to this drop from their library.
  const library = await prisma.vendorProduct.findMany({
    where: { sellerId: seller.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <Section>
      <BackLink href={`/dashboard/drops/${drop.id}`}>Back to drop</BackLink>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-3 mb-7">
        Edit drop
      </h1>
      {copied && (
        <div className="mb-6 rounded-card bg-sage-tint text-sage border border-sage/30 px-4 py-3 text-sm font-medium">
          Drop copied. Set your new dates and publish when ready.
        </div>
      )}
      <DropEditor
        mode="edit"
        dropId={drop.id}
        action={updateDropFullAction}
        category={seller.category}
        dropMode={drop.mode === "live" ? "live" : "preorder"}
        timeZone={seller.timezone ?? undefined}
        savedProducts={library.map((vp) => ({
          id: vp.id,
          emoji: vp.emoji,
          name: vp.name,
          desc: vp.description ?? "",
          price: (vp.priceCents / 100).toFixed(2),
          imageUrl: vp.imageUrl,
          images: vp.images ?? [],
          category: vp.category ?? "",
          productType: vp.productType ?? "",
          condition: vp.condition ?? "",
          rarity: vp.rarity ?? "",
        }))}
        defaults={{
          title: drop.title,
          description: drop.description ?? "",
          fulfillment: drop.fulfillment,
          location: drop.pickupInfo ?? "",
          opensAt: toIso(drop.opensAt),
          closesAt: toIso(drop.closesAt),
          pickupStartAt: toIso(drop.pickupStartAt),
          pickupEndAt: toIso(drop.pickupEndAt),
          pickupLocationName: drop.pickupLocationName ?? "",
          pickupAddress: drop.pickupAddress ?? "",
          pickupLat: drop.pickupLat,
          pickupLng: drop.pickupLng,
          pickupNotes: drop.pickupNotes ?? "",
          pickupFindMe: drop.pickupFindMe ?? "",
          pickupLine1: drop.pickupLine1,
          pickupCity: drop.pickupCity,
          pickupState: drop.pickupState,
          pickupPostal: drop.pickupPostal,
          pickupCountry: drop.pickupCountry,
          status: drop.status,
          products: drop.products.map((p) => ({
            id: p.id,
            vendorProductId: p.vendorProductId,
            emoji: p.emoji,
            name: p.name,
            desc: p.description ?? "",
            price: (p.priceCents / 100).toFixed(2),
            inventory: String(p.inventory),
            imageUrl: p.imageUrl,
            images: p.images ?? [],
            productType: p.productType ?? "",
            condition: p.condition ?? "",
            rarity: p.rarity ?? "",
            orderCount: p._count.orderItems,
          })),
        }}
      />
    </Section>
  );
}
