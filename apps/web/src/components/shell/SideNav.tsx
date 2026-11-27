"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";

export function SideNav({ propertySlug, businessDate }: { propertySlug: string; businessDate: string }) {
  const pathname = usePathname();
  const base = `/p/${propertySlug}`;
  return (
    <nav aria-label="Main" className="w-[232px] shrink-0 border-r border-line bg-surface px-3 py-4 flex flex-col gap-5 max-md:w-full max-md:border-r-0 max-md:border-b">
      {NAV.map((g) => (
        <div key={g.title} className="flex flex-col gap-0.5">
          <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.title}</div>
          {g.items.map((it) => {
            const href = it.path ? `${base}/${it.path}` : base;
            const active = it.path ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base;
            return (
              <Link
                key={it.key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] no-underline ${
                  active ? "bg-accent-soft font-semibold text-accent-hover" : "font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
                }`}
              >
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? "bg-accent-ring" : "bg-[#d4d4d2]"}`} />
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="mt-auto rounded-[10px] border border-line-soft p-3 text-xs leading-relaxed text-muted">
        <b className="text-ink">Business date</b>
        <br />
        {businessDate}
      </div>
    </nav>
  );
}
