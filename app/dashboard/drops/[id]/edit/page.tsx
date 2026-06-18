import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateDropFullAction } from "@/lib/actions/dashboard";
import { DropEditor } from "@/components/drop-editor";
import { Section } from "@/components/dashboard-ui";

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
      <Link href={`/dashboard/drops/${drop.id}`} className="text-sm text-muted hover:text-ink">
        ← Back to drop
      </Link>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-3 mb-7">
        Edit drop
      </h1>
      <DropEditor
        mode="edit"
        dropId={drop.id}
        action={updateDropFullAction}
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
          })),
        }}
      />
    </Section>
  );
}
