"use client";

import Link from "next/link";
import { useState } from "react";
import { ConnectionStatus } from "./ConnectionStatus";
import type { ConnectionState as ConnectionStateT } from "@/server/sync/status";

export interface PropertyOption {
  slug: string;
  name: string;
  role: string;
}

function Icon({ d, label }: { d: string; label: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label={label} role="img">
      <path d={d} />
    </svg>
  );
}

export function TopBar({ propertySlug, propertyName, properties, userInitials, userName, role, connection }: {
  propertySlug: string;
  propertyName: string;
  properties: PropertyOption[];
  userInitials: string;
  userName: string;
  role: string;
  connection?: ConnectionStateT | null;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const base = `/p/${propertySlug}`;
  return (
    <header className="relative z-20 border-b border-line bg-surface">
      <div className="flex min-h-14 flex-wrap items-center gap-3 px-5 py-2">
        <Link href={base} className="flex items-center gap-2.5 text-ink no-underline">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-tile text-[15px] font-bold text-white" aria-hidden="true">S</span>
          <span className="text-[15px] font-bold">Sentire PMS</span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="flex h-9 items-center gap-2 rounded-control border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-muted"
        >
          {propertyName}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <label className="flex h-9 max-w-[520px] flex-[1_1_240px] items-center gap-2 rounded-full border border-line bg-surface-muted px-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#636363" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="sr-only">Search</span>
          <input placeholder="Search reservations, guests, rooms" className="flex-1 border-0 bg-transparent text-[13px] text-ink outline-none" />
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <ConnectionStatus initial={connection} />
          <Link href={`${base}/reservations/new`} className="flex h-9 items-center gap-1.5 rounded-control bg-accent px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-accent-hover hover:text-white">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New reservation
          </Link>
          <Link href={`${base}/calendar`} className="flex h-9 w-9 items-center justify-center rounded-control text-ink-2 hover:bg-surface-muted">
            <Icon label="Calendar" d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" />
          </Link>
          <Link href={`${base}/housekeeping`} className="flex h-9 w-9 items-center justify-center rounded-control text-ink-2 hover:bg-surface-muted">
            <Icon label="Housekeeping" d="M3 18v-6a2 2 0 012-2h14a2 2 0 012 2v6M3 18h18M3 14h18" />
          </Link>
          <div className="relative">
            <button type="button" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label={`Account menu for ${userName}`} className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-[#f1e7df] text-xs font-bold text-[#7c2d12]">
              {userInitials}
            </button>
            {menu && (
              <div className="absolute right-0 top-10 w-[220px] rounded-card border border-line bg-surface p-3 shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
                <div className="text-[13px] font-semibold">{userName}</div>
                <div className="mb-2 text-xs text-muted">{role}</div>
                <Link href={`${base}/settings`} className="block rounded-control px-2 py-1.5 text-[13px] text-ink no-underline hover:bg-surface-muted">Settings</Link>
                <form action="/sign-out" method="post">
                  <button type="submit" className="w-full rounded-control px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-muted">Sign out</button>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div role="listbox" aria-label="Properties" className="absolute left-[150px] top-[52px] flex w-[320px] flex-col gap-1.5 rounded-card border border-line bg-surface p-3 shadow-[0_12px_32px_rgba(0,0,0,0.12)]">
          {properties.map((p) => (
            <Link
              key={p.slug}
              href={`/p/${p.slug}`}
              role="option"
              aria-selected={p.slug === propertySlug}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-control p-2.5 no-underline hover:bg-surface-muted"
            >
              <span>
                <span className="block text-[13px] font-semibold text-ink">{p.name}</span>
                <span className="text-xs text-muted">{p.role}</span>
              </span>
              {p.slug === propertySlug && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-hover">Current</span>}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
