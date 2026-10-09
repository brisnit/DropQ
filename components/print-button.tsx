"use client";

import { Button } from "@/components/ui";

/** Opens the browser's print dialog. Client-only because window.print is. */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()} size="md">
      Print this list
    </Button>
  );
}
