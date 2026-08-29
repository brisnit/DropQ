import { createHmac } from "node:crypto";
import { TEST_SESSION_SECRET } from "./guard.mjs";

/**
 * Mint the vendor session cookie directly.
 *
 * The same HMAC scheme `lib/auth.ts` signs with, and the same technique
 * `app/api/dev/date-picker-selftest` already uses. Driving the real login form
 * would need a password on the fixture and would re-test auth on every spec;
 * this keeps the suite about the thing under test.
 */
export function sessionCookie(sellerId, secret = TEST_SESSION_SECRET) {
  const value = `${sellerId}.${createHmac("sha256", secret).update(sellerId).digest("hex")}`;
  return { name: "hp_session", value, domain: "localhost", path: "/" };
}
