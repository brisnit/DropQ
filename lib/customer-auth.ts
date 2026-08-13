import "server-only";
import crypto, { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

/**
 * Customer authentication — deliberately separate from vendor auth (lib/auth.ts).
 *
 * Customers have no password. They sign in with a single-use magic link mailed
 * to the address they already used at checkout, which sets its own cookie. The
 * two systems share only the signing secret's *scheme*, never a cookie or a
 * session id, so a customer session can never be mistaken for a vendor session.
 */

const SECRET = process.env.SESSION_SECRET || "dropq-dev-secret";
const COOKIE = "dq_customer";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days — buyers return infrequently
const LINK_TTL_MS = 1000 * 60 * 30; // 30 minutes

// Namespaced so a vendor session token can never validate as a customer token
// (and vice versa) even though both are HMAC'd with the same secret.
function sign(id: string): string {
  const sig = crypto.createHmac("sha256", SECRET).update(`customer:${id}`).digest("hex");
  return `${id}.${sig}`;
}

function unsign(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(`customer:${id}`).digest("hex");
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

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ── Session ────────────────────────────────────────────────────────────────

export async function createCustomerSession(customerId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(customerId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function destroyCustomerSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionCustomerId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return unsign(token);
}

export async function getCurrentCustomer() {
  const id = await getSessionCustomerId();
  if (!id) return null;
  return prisma.customer.findUnique({ where: { id } });
}

/** Redirects to the magic-link sign-in when there's no customer session. */
export async function requireCustomer(returnTo?: string) {
  const customer = await getCurrentCustomer();
  if (!customer) {
    redirect(returnTo ? `/messages/login?next=${encodeURIComponent(returnTo)}` : "/messages/login");
  }
  return customer;
}

// ── Customer records ───────────────────────────────────────────────────────

/**
 * Find-or-create the durable Customer for an email. Called at checkout and by
 * the backfill, so a buyer has an identity before they ever sign in. Name and
 * phone fill in opportunistically — we never blank out a value we already hold.
 */
export async function upsertCustomer(input: {
  email: string;
  name?: string | null;
  phone?: string | null;
}) {
  const email = normalizeEmail(input.email);
  if (!email) return null;

  const existing = await prisma.customer.findUnique({ where: { email } });
  if (existing) {
    const patch: { name?: string; phone?: string } = {};
    if (!existing.name && input.name) patch.name = input.name;
    if (!existing.phone && input.phone) patch.phone = input.phone;
    if (Object.keys(patch).length === 0) return existing;
    return prisma.customer.update({ where: { id: existing.id }, data: patch });
  }

  return prisma.customer.create({
    data: { email, name: input.name?.trim() || null, phone: input.phone?.trim() || null },
  });
}

// ── Magic links ────────────────────────────────────────────────────────────

/**
 * Issue a single-use sign-in token. Only the hash is stored. Any outstanding
 * tokens for the customer are dropped first so an old link in an inbox can't be
 * replayed after a new one is requested.
 */
export async function createMagicLinkToken(
  customerId: string,
  intent?: { followSellerId?: string | null }
): Promise<string> {
  const raw = randomBytes(32).toString("hex");
  await prisma.customerToken.deleteMany({ where: { customerId } });
  await prisma.customerToken.create({
    data: {
      customerId,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
      followSellerId: intent?.followSellerId ?? null,
    },
  });
  return raw;
}

export type ConsumedToken = { customerId: string; followSellerId: string | null };

/**
 * Validate + consume a magic-link token. Returns the customer and whatever
 * intent was recorded when the link was issued, or null.
 */
export async function consumeMagicLinkToken(
  raw: string | null | undefined
): Promise<ConsumedToken | null> {
  if (!raw) return null;
  const tok = await prisma.customerToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!tok) return null;

  // Single-use: burn it whether or not it turns out to be valid.
  await prisma.customerToken.delete({ where: { id: tok.id } }).catch(() => {});

  if (tok.usedAt) return null;
  if (tok.expiresAt.getTime() < Date.now()) return null;
  return { customerId: tok.customerId, followSellerId: tok.followSellerId };
}
