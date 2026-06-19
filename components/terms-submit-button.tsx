"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";

export function TermsSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "I agree — continue"}
    </Button>
  );
}
