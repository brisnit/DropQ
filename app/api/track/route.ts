// Analytics sink for Vendor Finder events. Logs a compact, PII-free line to the
// server console (viewable in Vercel logs). Intentionally minimal — swap the
// console.log for a real analytics pipeline later without touching callers.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const event = String(body?.event ?? "unknown");
    const origin = body?.origin?.slug ?? body?.origin?.id ?? null;
    console.log(
      `[discovery] ${event}`,
      JSON.stringify({ props: body?.props ?? {}, origin, path: body?.path ?? null })
    );
  } catch {
    /* ignore malformed beacons */
  }
  // 204: no body needed for a fire-and-forget beacon.
  return new Response(null, { status: 204 });
}
