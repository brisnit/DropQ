"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export type ReviewState = { error?: string; submitted?: boolean };

/** Public: a customer leaves a service + quality rating and an optional comment. */
export async function submitReviewAction(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  const slug = String(formData.get("slug") ?? "");
  const authorName = String(formData.get("authorName") ?? "").trim();
  const service = parseInt(String(formData.get("serviceRating") ?? "0"), 10);
  const quality = parseInt(String(formData.get("qualityRating") ?? "0"), 10);
  const comment = String(formData.get("comment") ?? "").trim().slice(0, 1000) || null;

  if (!authorName) return { error: "Please add your name." };
  if (!(service >= 1 && service <= 5))
    return { error: "Please give a service rating (1–5 stars)." };
  if (!(quality >= 1 && quality <= 5))
    return { error: "Please give a product-quality rating (1–5 stars)." };

  const seller = await prisma.seller.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!seller) return { error: "Store not found." };

  await prisma.review.create({
    data: {
      sellerId: seller.id,
      authorName: authorName.slice(0, 80),
      serviceRating: service,
      qualityRating: quality,
      comment,
    },
  });

  revalidatePath(`/s/${slug}`);
  return { submitted: true };
}
