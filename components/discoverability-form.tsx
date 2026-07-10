"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input } from "@/components/ui";
import { updateDiscoverabilityAction, type DiscoverabilityState } from "@/lib/actions/dashboard";
import { track } from "@/lib/analytics";

export type DiscoverabilityData = {
  isDiscoverable: boolean;
  showActiveDropsInDiscovery: boolean;
  showEventsInDiscovery: boolean;
  hideExactAddress: boolean;
  publicNeighborhood: string | null;
  publicCity: string | null;
  publicState: string | null;
  publicZip: string | null;
  discoveryRadius: number;
};

const RADII = [10, 25, 50, 100];

function Toggle({
  name, checked, onChange, title, desc,
}: {
  name: string; checked: boolean; onChange: (v: boolean) => void; title: string; desc: string;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer py-2">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 accent-[#ff6268]"
      />
      <span>
        <span className="font-medium block">{title}</span>
        <span className="text-sm text-muted">{desc}</span>
      </span>
    </label>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save discovery settings"}</Button>;
}

export function DiscoverabilityForm({ data }: { data: DiscoverabilityData }) {
  const [state, formAction] = useActionState<DiscoverabilityState, FormData>(updateDiscoverabilityAction, {});
  const [on, setOn] = useState(data.isDiscoverable);
  const [activeDrops, setActiveDrops] = useState(data.showActiveDropsInDiscovery);
  const [events, setEvents] = useState(data.showEventsInDiscovery);
  const [hideAddr, setHideAddr] = useState(data.hideExactAddress);
  const [radius, setRadius] = useState(data.discoveryRadius);

  return (
    <form
      action={formAction}
      onSubmit={() => track(on ? "vendor_discoverability_enabled" : "vendor_discoverability_disabled")}
      className="space-y-6 max-w-2xl"
    >
      {/* Master switch */}
      <div className="bg-paper border border-line rounded-card p-6 sm:p-8">
        <Toggle
          name="isDiscoverable"
          checked={on}
          onChange={setOn}
          title="Show my storefront in DropQ discovery"
          desc="List your store on the public Find Drops page so nearby customers can discover you. Off by default."
        />
        {on && (
          <div className="mt-2 border-t border-line pt-2">
            <Toggle name="showActiveDropsInDiscovery" checked={activeDrops} onChange={setActiveDrops}
              title="Show my active drops in nearby search" desc="Your live and upcoming preorder drops appear in results." />
            <Toggle name="showEventsInDiscovery" checked={events} onChange={setEvents}
              title="Show my pop-ups and markets" desc="Your live/on-site events appear under Pop-Ups & Markets." />
            <Toggle name="hideExactAddress" checked={hideAddr} onChange={setHideAddr}
              title="Hide my exact address until a customer orders" desc="Discovery only shows your city/neighborhood and approximate distance. Recommended." />
          </div>
        )}
      </div>

      {/* Public location */}
      {on && (
        <div className="bg-paper border border-line rounded-card p-6 sm:p-8 space-y-5">
          <div>
            <h2 className="font-semibold text-lg">Public location</h2>
            <p className="text-muted text-sm mt-1">
              Shown in discovery and used to place you in nearby searches. City-level only —
              your exact pickup address is never shown here.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="City"><Input name="publicCity" defaultValue={data.publicCity ?? ""} placeholder="Austin" /></Field>
            <Field label="State"><Input name="publicState" defaultValue={data.publicState ?? ""} placeholder="TX" /></Field>
            <Field label="ZIP code" hint="Helps ZIP-based searches match you."><Input name="publicZip" defaultValue={data.publicZip ?? ""} placeholder="78702" /></Field>
            <Field label="Neighborhood" hint="Optional."><Input name="publicNeighborhood" defaultValue={data.publicNeighborhood ?? ""} placeholder="East Austin" /></Field>
          </div>
          <Field label="Service radius">
            <input type="hidden" name="discoveryRadius" value={radius} />
            <div className="flex gap-2 flex-wrap">
              {RADII.map((r) => (
                <button type="button" key={r} onClick={() => setRadius(r)}
                  className={`text-sm font-medium px-3.5 py-1.5 rounded-pill border transition ${radius === r ? "bg-ink text-cream border-ink" : "border-line-strong text-ink-soft hover:border-ink/30"}`}>
                  {r} mi
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      <div className="flex items-center gap-3">
        <SaveBtn />
        {state.saved && <span className="text-sm text-sage font-medium">✓ Saved</span>}
        {state.error && <span className="text-sm text-brand-dark">{state.error}</span>}
      </div>
    </form>
  );
}
