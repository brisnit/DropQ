import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentSeller } from "@/lib/auth";

// Hard server-side cap per image (the client also compresses + size-checks).
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

/**
 * Client-upload token endpoint. The browser uploads product photos directly to
 * Vercel Blob (bypassing the ~4.5MB serverless request limit), so a drop can
 * carry many images without 413s. Only signed-in vendors can mint tokens.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const seller = await getCurrentSeller();
        if (!seller) throw new Error("Sign in to upload images.");
        return {
          allowedContentTypes: [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/avif",
            "image/gif",
          ],
          maximumSizeInBytes: MAX_IMAGE_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ sellerId: seller.id }),
        };
      },
      // Required by the API; nothing to persist here — URLs are saved with the drop.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 400 }
    );
  }
}
