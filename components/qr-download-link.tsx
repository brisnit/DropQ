"use client";

import { markSharedAction } from "@/lib/actions/guidance";
import { trackGuidance } from "@/lib/analytics";

/**
 * The drop QR download, with the share signal attached.
 *
 * Downloading the QR is a vendor putting their drop in front of customers just
 * as much as copying the link is — it is the version they print and put on the
 * table — so it completes the "Share your drop" milestone too.
 *
 * A client component purely so the click can be observed. The anchor itself is
 * unchanged: same `href`, same `download`, same styling, so the download still
 * works exactly as before even if the signal fails.
 */
export function QrDownloadLink({
  href,
  download,
  className = "",
  children,
}: {
  href: string;
  download: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      download={download}
      className={className}
      onClick={() => {
        // Fire-and-forget: the browser is already starting the download and
        // must not wait on guidance bookkeeping.
        trackGuidance("drop_shared", { method: "qr_download" });
        void markSharedAction().catch(() => {});
      }}
    >
      {children}
    </a>
  );
}
