"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { path: "", label: "Availability matrix" },
  { path: "bulk", label: "Bulk update" },
  { path: "plans", label: "Rate plans" },
  { path: "policies", label: "Policies" },
];

export function RatesNav({ base }: { base: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Rates" className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {TABS.map((t) => {
        const href = t.path ? `${base}/${t.path}` : base;
        const active = t.path ? path.startsWith(href) : path === base;
        return (
          <Link key={t.path} href={href} aria-current={active ? "page" : undefined} className={`-mb-px border-b-2 px-3 py-2 text-[13px] no-underline ${active ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
