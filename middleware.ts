import { NextResponse, type NextRequest } from "next/server";

/**
 * First-touch vendor attribution.
 *
 * This has to live in middleware: `cookies().set()` only works in a Server
 * Function or Route Handler, so a page can't record the touch itself — it
 * would silently no-op. Middleware can set cookies on the response and runs
 * before the page, which is exactly what's needed.
 *
 * Middleware is edge runtime with no Prisma, so the cookie stores the vendor
 * *slug* straight off the URL. lib/attribution.ts resolves it to a seller id
 * later, when there's an identity to attach it to.
 *
 * First write wins for the cookie's lifetime: someone who arrives through
 * vendor A and later browses vendor B is still A's acquisition.
 */

const TOUCH_COOKIE = "dq_touch";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days to convert

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (request.cookies.has(TOUCH_COOKIE)) return response;

  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  // /s/<slug>            → storefront
  // /s/<slug>/<dropId>   → a specific drop
  if (segments[0] !== "s" || !segments[1]) return response;

  const vendorSlug = segments[1];
  const dropId = segments[2] ?? null;

  // ?ref= / ?utm_source= tell us how the link was shared (QR, IG, text).
  const ref = request.nextUrl.searchParams.get("ref");
  const utm = request.nextUrl.searchParams.get("utm_source");
  const source = dropId ? "drop" : "storefront";

  response.cookies.set(
    TOUCH_COOKIE,
    JSON.stringify({
      vendorSlug,
      dropId,
      source: ref === "qr" || utm === "qr" ? "qr" : source,
      detail: ref ?? utm ?? null,
      at: new Date().toISOString(),
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
      secure: process.env.NODE_ENV === "production",
    }
  );

  return response;
}

export const config = {
  // Storefront and drop pages only — never assets or API routes.
  matcher: ["/s/:slug", "/s/:slug/:dropId"],
};
