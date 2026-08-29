import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { HELP_ARTICLES } from "@/lib/help/content";
import { articleBySlug, relatedArticles, hasCapability } from "@/lib/help/search";
import { CATEGORY_LABELS } from "@/lib/help/types";
import { HelpBody } from "@/components/help/panel";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { readerCapabilities } from "@/app/help/page";

export async function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const a = articleBySlug(slug);
  if (!a) return { title: "Help — DropQ" };
  return { title: `${a.title} — DropQ help`, description: a.summary };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = articleBySlug(slug);
  if (!article) notFound();

  const caps = await readerCapabilities();
  // A capability-gated article is not public. 404 rather than render it:
  // describing a feature someone does not have makes the product look broken.
  if (article.requires && !hasCapability(article.requires, caps)) notFound();

  const related = relatedArticles(article, caps);

  return (
    <>
      <SiteNav />
      <main className="max-w-2xl mx-auto px-5 py-14">
        <Link href="/help" className="text-sm text-muted hover:text-ink">
          ← All help
        </Link>
        <p className="text-xs font-semibold uppercase tracking-wider text-brand mt-6">
          {CATEGORY_LABELS[article.category]}
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight mt-2 leading-tight">
          {article.title}
        </h1>
        <p className="text-muted mt-2">{article.question}</p>
        <div className="mt-7 space-y-4">
          <HelpBody article={article} />
        </div>

        {related.length > 0 && (
          <div className="mt-12 pt-6 border-t border-line">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
              Related
            </h2>
            <ul className="space-y-2">
              {related.map((a) => (
                <li key={a.id}>
                  <Link href={`/help/${a.slug}`} className="text-brand hover:underline">
                    {a.title}
                  </Link>
                  <span className="block text-sm text-muted">{a.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
