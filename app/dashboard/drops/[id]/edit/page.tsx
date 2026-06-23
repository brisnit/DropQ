import { notFound } from "next/navigation";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateDropFullAction } from "@/lib/actions/dashboard";
import { DropEditor } from "@/components/drop-editor";
import { Section } from "@/components/dashboard-ui";
import { BackLink } from "@/components/back-link";

export const metadata = { title: "Edit drop — DropQ" };

function toLocalInput(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 16) : "";
}

export default async function EditDropPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const seller = await requireSeller();
  const drop = await prisma.drop.findUnique({
    where: { id },
    include: { products: { orderBy: { sortOrder: "asc" } } },
  });
  if (!drop || drop.sellerId !== seller.id) notFound();

  return (
    <Section>
      <BackLink href={`/dashboard/drops/${drop.id}`}>Back to drop</BackLink>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-3 mb-7">
        Edit drop
      </h1>
      <DropEditor
        mode="edit"
        dropId={drop.id}
        action={updateDropFullAction}
        category={seller.category}
        dropMode={drop.mode === "live" ? "live" : "preorder"}
        defaults={{
          title: drop.title,
          description: drop.description ?? "",
          fulfillment: drop.fulfillment,
          location: drop.pickupInfo ?? "",
          opensAt: toLocalInput(drop.opensAt),
          closesAt: toLocalInput(drop.closesAt),
          status: drop.status,
          products: drop.products.map((p) => ({
            id: p.id,
            emoji: p.emoji,
            name: p.name,
            desc: p.description ?? "",
            price: (p.priceCents / 100).toFixed(2),
            inventory: String(p.inventory),
            imageUrl: p.imageUrl,
            productType: p.productType ?? "",
            condition: p.condition ?? "",
            rarity: p.rarity ?? "",
          })),
        }}
      />
    </Section>
  );
}
