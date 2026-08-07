"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { AUDIENCES, MAX_BODY, type Audience } from "@/lib/messaging-shared";
import type { BroadcastState } from "@/lib/actions/messages";
import { Avatar } from "@/components/avatar";

export type BroadcastCustomer = { id: string; name: string; statusLabel: string };

/**
 * Announcement flow: pick an audience, write once, confirm against a real
 * recipient count, send. Each recipient gets the message in their own private
 * conversation — never a group thread — so replies stay between the vendor and
 * that one customer.
 */
export function BroadcastComposer({
  dropId,
  counts,
  customers,
  action,
}: {
  dropId: string | null;
  counts: Record<Audience, number>;
  customers: BroadcastCustomer[];
  action: (prev: BroadcastState, formData: FormData) => Promise<BroadcastState>;
}) {
  const [open, setOpen] = useState(false);
  const [audience, setAudience] = useState<Audience>("drop_all");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<BroadcastState, FormData>(action, {});

  const recipientCount = audience === "selected" ? selected.length : counts[audience];
  const canReview = body.trim().length > 0 && recipientCount > 0;

  const options = useMemo(
    () => (Object.keys(AUDIENCES) as Audience[]).map((k) => ({ key: k, label: AUDIENCES[k] })),
    []
  );

  if (state.ok) {
    return (
      <div className="bg-paper border border-line rounded-card p-6 text-center">
        <div className="text-3xl">📣</div>
        <h3 className="font-display text-lg font-semibold mt-2">Announcement sent</h3>
        <p className="text-sm text-muted mt-1">
          Delivered to {state.sent} customer{state.sent === 1 ? "" : "s"}, each in their own private
          conversation.
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirming(false);
            setBody("");
            setSelected([]);
            // Drop the success state by remounting on next open.
            window.location.reload();
          }}
          className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold"
        >
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-pill bg-ink text-cream text-sm font-semibold transition active:scale-[0.98] hover:bg-ink-soft"
      >
        <span aria-hidden>📣</span> Send Announcement
      </button>
    );
  }

  return (
    <form action={formAction} className="bg-paper border border-line rounded-card p-5 space-y-4">
      <input type="hidden" name="dropId" value={dropId ?? ""} />
      <input type="hidden" name="audience" value={audience} />
      {audience === "selected" &&
        selected.map((id) => <input key={id} type="hidden" name="customerIds" value={id} />)}

      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Send Announcement</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirming(false);
          }}
          className="text-sm text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {!confirming ? (
        <>
          {/* Audience */}
          <div>
            <span className="block text-sm font-medium text-ink-soft mb-2">Who gets this?</span>
            <div className="grid gap-2">
              {options.map((o) => {
                const n = o.key === "selected" ? selected.length : counts[o.key];
                const active = audience === o.key;
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setAudience(o.key)}
                    className={`flex items-center justify-between gap-3 min-h-[52px] px-4 rounded-xl border text-left transition ${
                      active
                        ? "border-ink bg-cream"
                        : "border-line-strong bg-paper hover:border-ink/25"
                    }`}
                  >
                    <span className="text-sm font-medium">{o.label}</span>
                    <span className="text-xs text-muted shrink-0">
                      {n} customer{n === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Individual picker */}
          {audience === "selected" && (
            <div className="border border-line rounded-xl max-h-56 overflow-y-auto divide-y divide-line">
              {customers.length === 0 && (
                <p className="text-sm text-muted p-4 text-center">No customers in this drop yet.</p>
              )}
              {customers.map((c) => {
                const on = selected.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-4 py-3 min-h-[52px] cursor-pointer hover:bg-cream/70"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSelected((prev) =>
                          on ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                        )
                      }
                      className="w-4 h-4 accent-[#ff6268]"
                    />
                    <Avatar name={c.name} size="sm" seed={c.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium truncate">{c.name}</span>
                      <span className="block text-xs text-muted truncate">{c.statusLabel}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* Message */}
          <div>
            <span className="block text-sm font-medium text-ink-soft mb-1.5">Your message</span>
            <textarea
              name="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={MAX_BODY}
              placeholder="Running 15 minutes behind — pickup now starts at 5:15pm. Sorry for the wait!"
              className="w-full bg-cream/60 border border-line-strong rounded-xl px-3.5 py-2.5 resize-y focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition"
            />
            <span className="block text-xs text-muted mt-1">
              {body.trim().length}/{MAX_BODY}
            </span>
          </div>

          {state.error && (
            <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
          )}

          <button
            type="button"
            disabled={!canReview}
            onClick={() => setConfirming(true)}
            className="w-full min-h-[48px] rounded-xl bg-ink text-cream font-semibold text-sm transition active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none"
          >
            Review announcement
          </button>
        </>
      ) : (
        <>
          {/* Confirmation */}
          <div className="bg-cream border border-line rounded-xl p-4 space-y-3">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Audience
              </span>
              <p className="font-medium mt-0.5">{AUDIENCES[audience]}</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Recipients
              </span>
              <p className="font-display text-2xl font-semibold mt-0.5">{recipientCount}</p>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Preview
              </span>
              <div className="mt-1.5 flex justify-start">
                <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-brand-tint text-ink text-[0.95rem] leading-snug whitespace-pre-wrap break-words">
                  {body.trim()}
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted">
            Each customer receives this privately. Their replies come back to you alone — no one
            sees anyone else.
          </p>

          {state.error && (
            <p className="text-sm text-brand-dark bg-brand-tint rounded-lg px-3 py-2">{state.error}</p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="min-h-[48px] px-5 rounded-xl border border-line-strong text-sm font-medium text-ink-soft hover:bg-line/40 transition"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={pending}
              className="flex-1 min-h-[48px] rounded-xl bg-brand text-white font-semibold text-sm transition active:scale-[0.99] disabled:opacity-50"
            >
              {pending
                ? "Sending…"
                : `Send to ${recipientCount} Customer${recipientCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
