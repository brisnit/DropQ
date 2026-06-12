import "server-only";
import { randomBytes, createHash } from "crypto";
import { prisma } from "@/lib/db";

export type TokenType = "verify" | "reset";

const TTL_MS: Record<TokenType, number> = {
  verify: 1000 * 60 * 60 * 24, // 24h
  reset: 1000 * 60 * 60, // 1h
};

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Create a single-use token, store only its hash, return the raw token. */
export async function createToken(sellerId: string, type: TokenType): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  // Invalidate any prior tokens of this type for the seller.
  await prisma.token.deleteMany({ where: { sellerId, type } });
  await prisma.token.create({
    data: {
      sellerId,
      type,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + TTL_MS[type]),
    },
  });
  return raw;
}

/** Validate + consume a token. Returns the sellerId, or null if invalid/expired. */
export async function consumeToken(
  raw: string | null | undefined,
  type: TokenType
): Promise<string | null> {
  if (!raw) return null;
  const tok = await prisma.token.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!tok || tok.type !== type) return null;

  // Always remove the matched token (single-use).
  await prisma.token.delete({ where: { id: tok.id } }).catch(() => {});

  if (tok.expiresAt.getTime() < Date.now()) return null;
  return tok.sellerId;
}
