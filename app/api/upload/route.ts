import { NextResponse } from "next/server";
import { getCurrentSeller } from "@/lib/auth";
import { saveImage } from "@/lib/upload";

/**
 * Upload one (already client-compressed) product photo. The browser posts a
 * single small image per request, so this reuses the proven server-side Blob
 * `put` (same store as logos/headers) and stays well under the request limit.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const seller = await getCurrentSeller();
  if (!seller) {
    return NextResponse.json({ error: "Sign in to upload images." }, { status: 401 });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  const url = await saveImage(form.get("file"));
  if (!url) {
    return NextResponse.json(
      { error: "Couldn't save that image. Use a JPG, PNG, or WebP under 8MB." },
      { status: 400 }
    );
  }
  return NextResponse.json({ url });
}
