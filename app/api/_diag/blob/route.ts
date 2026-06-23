// TEMPORARY diagnostic — reports only booleans, never the secret value.
export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  let putOk: boolean | string = false;
  if (token) {
    try {
      const { put } = await import("@vercel/blob");
      const blob = await put(
        `uploads/_diag-${Date.now()}.txt`,
        "ok",
        { access: "public", contentType: "text/plain" }
      );
      putOk = blob.url.includes("://") ? true : "no-url";
    } catch (e) {
      putOk = e instanceof Error ? e.message.slice(0, 200) : "error";
    }
  }
  return Response.json({
    blobTokenPresent: !!token,
    tokenPrefix: token ? token.slice(0, 14) : null,
    vercel: !!process.env.VERCEL,
    putOk,
  });
}
