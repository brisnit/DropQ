"use client";

import { useEffect } from "react";
import { setOriginatingVendor } from "@/lib/analytics";

/**
 * Records the vendor a customer entered through (QR / shared link / storefront)
 * into sessionStorage, so discovery can later attribute additional visits/orders
 * and offer a "back to previous vendor" path. Renders nothing.
 */
export function OriginTracker({ vendorId, slug }: { vendorId: string; slug: string }) {
  useEffect(() => {
    setOriginatingVendor(vendorId, slug);
  }, [vendorId, slug]);
  return null;
}
