"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitReviewAction, type ReviewState } from "@/lib/actions/review";

function StarInput({
  label,
  name,
  value,
  setValue,
}: {
  label: string;
  name: string;
  value: number;
  setValue: (n: number) => void;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div>
      <p className="text-sm font-medium text-ink-soft mb-1">{label}</p>
      <input type="hidden" name={name} value={value} />
      <div className="flex gap-0.5" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            type="button"
            key={i}
            onClick={() => setValue(i)}
            onMouseEnter={() => setHover(i)}
            aria-label={`${i} star${i > 1 ? "s" : ""}`}
            className={`text-2xl leading-none transition ${
              (hover || value) >= i ? "text-quad" : "text-line-strong"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

function SubmitButton({ accent }: { accent: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      style={{ backgroundColor: accent }}
      className="text-white font-semibold rounded-xl px-5 py-2.5 disabled:opacity-50 transition active:scale-[0.99]"
    >
      {pending ? "Submitting…" : "Submit review"}
    </button>
  );
}

export function ReviewForm({ slug, accent }: { slug: string; accent: string }) {
  const [state, action] = useActionState<ReviewState, FormData>(submitReviewAction, {});
  const [service, setService] = useState(0);
  const [quality, setQuality] = useState(0);

  if (state.submitted) {
    return (
      <div className="bg-sage-tint text-sage rounded-card p-5 text-sm font-medium">
        ✓ Thanks for your review!
      </div>
    );
  }

  const inputCls =
    "w-full bg-paper border border-line-strong rounded-xl px-3.5 py-2.5 focus:outline-none focus:border-ink/40";

  return (
    <form action={action} className="bg-paper border border-line rounded-card p-5 space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <p className="font-semibold">Leave a review</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <StarInput label="Service" name="serviceRating" value={service} setValue={setService} />
        <StarInput label="Product quality" name="qualityRating" value={quality} setValue={setQuality} />
      </div>
      <input name="authorName" placeholder="Your name" required className={inputCls} />
      <textarea
        name="comment"
        placeholder="Share details about your experience (optional)"
        className={`${inputCls} resize-y min-h-[80px]`}
      />
      {state.error && (
        <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
      )}
      <SubmitButton accent={accent} />
    </form>
  );
}
