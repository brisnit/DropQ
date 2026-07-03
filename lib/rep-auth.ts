import "server-only";
import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";

// Sales reps get their OWN session cookie, fully separate from vendor/admin
// sessions. A rep can never reach vendor or admin surfaces, and vice-versa.
const SECRET = process.env.SESSION_SECRET || "dropq-dev-secret";
const COOKIE = "dropq_rep";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const NS = "rep:"; // namespace so a vendor token can't be reused as a rep token

function sign(id: string): string {
  const payload = NS + id;
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${id}.${sig}`;
}

function unsign(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(NS + id).digest("hex");
  try {
    if (sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return id;
    }
  } catch {
    return null;
  }
  return null;
}

export async function createRepSession(salesRepId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(salesRepId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroyRepSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** The logged-in sales rep, or null. Inactive reps are logged out. */
export async function getCurrentRep() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const id = unsign(token);
  if (!id) return null;
  const rep = await prisma.salesRep.findUnique({ where: { id } });
  if (!rep || rep.status !== "active" || !rep.passwordHash) return null;
  return rep;
}

export async function requireRep() {
  const rep = await getCurrentRep();
  if (!rep) redirect("/rep/login");
  return rep;
}
