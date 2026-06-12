import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken } from "@/lib/tokens";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const sellerId = await consumeToken(token, "verify");

  if (sellerId) {
    await prisma.seller.update({
      where: { id: sellerId },
      data: { emailVerified: true },
    });
    return Response.redirect(new URL("/dashboard?verified=1", req.url), 303);
  }
  return Response.redirect(new URL("/login?verify_error=1", req.url), 303);
}
