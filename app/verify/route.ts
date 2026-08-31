import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { consumeToken } from "@/lib/tokens";
import { consume } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

export async function GET(req: NextRequest) {
  // Bounded, not because a 256-bit token is guessable, but because an
  // unbounded endpoint that hits the database on every call is free work for
  // anyone who wants to hand it out. Over the limit looks exactly like a bad
  // token — no separate state to probe.
  const gate = await consume("tokenVerify", { ip: clientIp(req.headers) });
  if (!gate.allowed) {
    return Response.redirect(new URL("/login?verify_error=1", req.url), 303);
  }

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
