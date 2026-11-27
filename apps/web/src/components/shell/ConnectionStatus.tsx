"use client";

import { useEffect, useState } from "react";

interface Status {
  mode: "hub" | "cloud";
  sync: "online" | "offline" | "not-configured";
  lastSyncAt: string | null;
  pending: number | null;
}

const POLL_MS = 15_000;

/** Connection state shown on every screen (FR-53). */
export function ConnectionStatus() {
  const [s, setS] = useState<Status | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as Status;
        if (alive) {
          setS(j);
          setReachable(true);
        }
      } catch {
        if (alive) setReachable(false);
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  let label = "Checking...";
  let tone = "bg-[#f4f4f5] text-[#3f3f46]";
  let dot = "bg-[#a1a1aa]";
  if (!reachable) {
    label = "Hub not reachable";
    tone = "bg-[#fef2f2] text-[#991b1b]";
    dot = "bg-[#dc2626]";
  } else if (s?.mode === "cloud") {
    label = "Sentire Cloud";
    tone = "bg-[#eff6ff] text-[#1d4ed8]";
    dot = "bg-[#2563eb]";
  } else if (s?.sync === "online") {
    label = s.pending ? `Online, ${s.pending} to sync` : "Online";
    tone = "bg-[#ecfdf3] text-[#166534]";
    dot = "bg-[#16a34a]";
  } else if (s?.sync === "offline") {
    label = `Offline${s.pending ? `, ${s.pending} waiting` : ""}`;
    tone = "bg-[#fffbeb] text-[#92400e]";
    dot = "bg-[#d97706]";
  } else if (s?.sync === "not-configured") {
    label = "Local only, sync not set up";
    tone = "bg-[#fffbeb] text-[#92400e]";
    dot = "bg-[#d97706]";
  }

  return (
    <span role="status" aria-live="polite" className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold ${tone}`}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
