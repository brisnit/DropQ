import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createDropAction } from "@/lib/actions/dashboard";
import { DropEditor } from "@/components/drop-editor";
import { Section, EmptyState } from "@/components/dashboard-ui";
import { BackLink } from "@/components/back-link";
import { canCreateDrop, STARTER_DROP_LIMIT } from "@/lib/plans";

export const metadata = { title: "New drop — DropQ" };

export default async function NewDropPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const seller = await requireSeller();
  const { mode } = await searchParams;
  const dropMode = mode === "live" ? "live" : "preorder";

  // Starter plan: block past the lifetime drop limit and route toward Growth.
  if (!canCreateDrop(seller)) {
    return (
      <Section>
        <BackLink href="/dashboard/drops">Back to drops</BackLink>
        <div className="mt-3">
          <EmptyState
            emoji="🚀"
            title="You've used all your Starter drops"
            body={`Starter includes ${STARTER_DROP_LIMIT} drops total. Upgrade to Growth for unlimited drops, analytics, and the full selling toolkit — $20/mo.`}
            ctaHref="/dashboard/billing"
            ctaLabel="Upgrade to Growth"
          />
        </div>
      </Section>
    );
  }

  const library = await prisma.vendorProduct.findMany({
    where: { sellerId: seller.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <Section>
      <BackLink href="/dashboard/drops">Back to drops</BackLink>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-3 mb-7">
        {dropMode === "live" ? "Start a live selling drop" : "Create a drop"}
      </h1>
      <DropEditor
        action={createDropAction}
        category={seller.category}
        dropMode={dropMode}
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
      />
    </Section>
  );
}
