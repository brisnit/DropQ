import { getCurrentSeller } from "@/lib/auth";
import { prisma } from "@/lib/db";

function csvCell(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const seller = await getCurrentSeller();
  if (!seller) return new Response("Unauthorized", { status: 401 });

  const orders = await prisma.order.findMany({
    where: { sellerId: seller.id, status: { not: "pending" } },
    orderBy: { createdAt: "desc" },
    include: { items: true, drop: { select: { title: true } } },
  });

  const header = [
    "Order ID", "Date", "Status", "Drop", "Customer", "Email", "Phone",
    "Items", "Total (USD)", "DropQ Fee (USD)", "Net to you (USD)",
  ];
  const rows = orders.map((o) => [
    o.id,
    o.createdAt.toISOString(),
    o.status,
    o.drop.title,
    o.buyerName,
    o.buyerEmail,
    o.buyerPhone ?? "",
    o.items.map((it) => `${it.quantity}x ${it.name}`).join("; "),
    (o.totalCents / 100).toFixed(2),
    (o.feeCents / 100).toFixed(2),
    ((o.totalCents - o.feeCents) / 100).toFixed(2),
  ]);

  const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dropq-orders-${seller.slug}.csv"`,
    },
  });
}
