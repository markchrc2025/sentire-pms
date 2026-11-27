import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="m-0 text-[22px] font-bold">{title}</h1>
        {subtitle && <p className="m-0 mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="m-0 text-[15px] font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const btn = {
  primary: "bg-accent text-white hover:bg-accent-hover hover:text-white border-transparent",
  secondary: "bg-surface text-ink border-line hover:bg-surface-muted hover:text-ink",
  danger: "bg-surface text-[#991b1b] border-[#fecaca] hover:bg-[#fef2f2] hover:text-[#991b1b]",
};
export type Variant = keyof typeof btn;
const btnBase = "inline-flex h-9 items-center justify-center gap-1.5 rounded-control border px-3.5 text-[13px] font-semibold no-underline disabled:opacity-50 cursor-pointer";

export function Button({ variant = "secondary", className = "", ...p }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" {...p} className={`${btnBase} ${btn[variant]} ${className}`} />;
}

export function LinkButton({ variant = "secondary", className = "", ...p }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...p} className={`${btnBase} ${btn[variant]} ${className}`} />;
}

const inputCls = "h-9 w-full rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent-ring";

export function Field({ label, name, hint, error, className = "", ...p }: ComponentProps<"input"> & { label: string; name: string; hint?: string; error?: string }) {
  const id = p.id ?? `f-${name}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-2">{label}</label>
      <input id={id} name={name} {...p} className={inputCls} aria-invalid={error ? true : undefined} />
      {hint && !error && <span className="text-[11px] text-muted">{hint}</span>}
      {error && <span className="text-[11px] text-[#991b1b]">{error}</span>}
    </div>
  );
}

export function Select({ label, name, options, className = "", ...p }: ComponentProps<"select"> & { label: string; name: string; options: { value: string; label: string }[] }) {
  const id = p.id ?? `f-${name}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-2">{label}</label>
      <select id={id} name={name} {...p} className={inputCls}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function TextArea({ label, name, className = "", ...p }: ComponentProps<"textarea"> & { label: string; name: string }) {
  const id = p.id ?? `f-${name}`;
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-2">{label}</label>
      <textarea id={id} name={name} rows={3} {...p} className="w-full rounded-control border border-line bg-surface p-2.5 text-[13px] text-ink outline-none focus:border-accent-ring" />
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok" | "warn"; children: ReactNode }) {
  const c = { info: "border-line bg-surface-muted text-ink-2", error: "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]", ok: "border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]", warn: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]" }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-control border px-3 py-2 text-[13px] ${c}`}>{children}</div>;
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>{head.map((h, i) => <th key={i} className="border-b border-line px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">{h}</th>)}</tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-line-soft [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-middle">{children}</tbody>
      </table>
      {empty && <p className="m-0 p-4 text-center text-[13px] text-muted">{empty}</p>}
    </div>
  );
}

const STATUS: Record<string, string> = {
  CONFIRMED: "bg-[#eff6ff] text-[#1d4ed8]",
  CHECKED_IN: "bg-[#f0fdf4] text-[#15803d]",
  NOT_CONFIRMED: "bg-[#fffbeb] text-[#b45309]",
  CHECKED_OUT: "bg-[#f3f4f6] text-[#4b5563]",
  CANCELLED: "bg-[#fef2f2] text-[#991b1b]",
  NO_SHOW: "bg-[#fef2f2] text-[#991b1b]",
  CLEAN: "bg-[#f0fdf4] text-[#15803d]",
  DIRTY: "bg-[#fffbeb] text-[#b45309]",
  INSPECTED: "bg-[#eff6ff] text-[#1d4ed8]",
  OUT_OF_SERVICE: "bg-[#fef2f2] text-[#991b1b]",
};
export function Badge({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[status] ?? "bg-[#f3f4f6] text-ink-2"}`}>{children ?? labelOf(status)}</span>;
}
export function labelOf(s: string): string {
  const t = s.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
