import { requireSeller } from "@/lib/auth";
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
      />
    </Section>
  );
}
