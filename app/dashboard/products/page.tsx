import { requireSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader, Section } from "@/components/dashboard-ui";
import { ProductLibrary, type LibProduct } from "@/components/product-library";

export const metadata = { title: "Products — DropQ" };

export default async function ProductsPage() {
  const seller = await requireSeller();
  const products = await prisma.vendorProduct.findMany({
    where: { sellerId: seller.id },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
  });

  const items: LibProduct[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    priceDollars: p.priceCents ? (p.priceCents / 100).toFixed(2) : "",
    emoji: p.emoji,
    imageUrl: p.imageUrl,
    images: p.images ?? [],
    category: p.category,
    allergens: p.allergens,
    isActive: p.isActive,
  }));

  return (
    <Section>
      <PageHeader
        title="Product library"
        subtitle="Save the products you sell often and reuse them across drops — no recreating each time."
      />
      <ProductLibrary products={items} />
    </Section>
  );
}
