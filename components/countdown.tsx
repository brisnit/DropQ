"use client";

import { useEffect, useState } from "react";

/** Live-ticking countdown to an ISO instant. Shows a closed label once passed. */
export function Countdown({ to, closedLabel = "Ordering closed" }: { to: string; closedLabel?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <span className="text-muted">{closedLabel}</span>;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const label = d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  return <span className="tabular-nums font-semibold">{label}</span>;
}
