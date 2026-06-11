import Link from "next/link";
import { requireSeller } from "@/lib/auth";
import { createDropAction } from "@/lib/actions/dashboard";
import { DropEditor } from "@/components/drop-editor";
import { Section } from "@/components/dashboard-ui";

export const metadata = { title: "New drop — DropQ" };

export default async function NewDropPage() {
  await requireSeller();
  return (
    <Section>
      <Link href="/dashboard/drops" className="text-sm text-muted hover:text-ink">
        ← Back to drops
      </Link>
      <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight mt-3 mb-7">
        Create a drop
      </h1>
      <DropEditor action={createDropAction} />
    </Section>
  );
}
