import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";

const SECRET = process.env.SESSION_SECRET || "dropq-dev-secret";
const COOKIE = "hp_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function sign(id: string): string {
  const sig = crypto.createHmac("sha256", SECRET).update(id).digest("hex");
  return `${id}.${sig}`;
}

function unsign(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("hex");
  try {
    if (
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      return id;
    }
  } catch {
    return null;
  }
  return null;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export async function createSession(sellerId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(sellerId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionSellerId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return unsign(token);
}

export async function getCurrentSeller() {
  const id = await getSessionSellerId();
  if (!id) return null;
  const seller = await prisma.seller.findUnique({ where: { id } });
  // Suspended (or deleted) sellers get no access — effectively a force-logout.
  if (!seller || seller.disabledAt) return null;
  return seller;
}

export async function requireSeller() {
  const seller = await getCurrentSeller();
  if (!seller) redirect("/login");
  return seller;
}

/** Bootstrap admins via env allowlist (comma-separated emails) or the DB flag. */
export function isAdminEmail(email: string): boolean {
  const list = (process.env.DROPQ_ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export async function getCurrentAdmin() {
  const seller = await getCurrentSeller();
  if (!seller) return null;
  return seller.isAdmin || isAdminEmail(seller.email) ? seller : null;
}

export async function requireAdmin() {
  const seller = await getCurrentSeller();
  if (!seller) redirect("/login");
  if (!seller.isAdmin && !isAdminEmail(seller.email)) redirect("/dashboard");
  return seller;
}
