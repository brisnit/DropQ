import { requireSeller } from "@/lib/auth";
import { StripeRequiredBanner } from "@/components/stripe-required-banner";
import { loadActivationState, publishGate } from "@/lib/activation";
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
            title="You've used all your free drops"
            body={`Free includes ${STARTER_DROP_LIMIT} drops total. Upgrade to Basic for unlimited drops, analytics, and the full selling toolkit — $8/mo.`}
            ctaHref="/dashboard/billing"
            ctaLabel="Upgrade to Basic"
          />
        </div>
      </Section>
    );
  }

  // Publish gate (V.3). UX only — createDropAction still downgrades a forged
  // live request to a draft via resolveDropStatus.
  const gate = publishGate(await loadActivationState(seller));

  const library = await prisma.vendorProduct.findMany({
    where: { sellerId: seller.id, isActive: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <Section>
      <StripeRequiredBanner seller={seller} />
      <BackLink href="/dashboard/drops">Back to drops</BackLink>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-3 mb-7">
        {dropMode === "live" ? "Start a live selling drop" : "Create a drop"}
      </h1>
      <DropEditor
        publishGate={gate}
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
