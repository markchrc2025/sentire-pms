import Link from "next/link";
import { addDays, isIsoDate } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { calendarData } from "@/server/calendar";
import { getProperty } from "@/server/property";
import { CalendarGrid } from "./CalendarGrid";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ start?: string; days?: string }> }) {
  const { propertySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const p = await getProperty(db, ctx);
  const days = [7, 14, 30].includes(Number(sp.days)) ? Number(sp.days) : 14;
  const start = sp.start && isIsoDate(sp.start) ? sp.start : addDays(p.businessDate, -1);
  const data = await calendarData(db, ctx, start, days);
  const base = `/p/${propertySlug}/calendar`;
  const q = (o: Record<string, string>) => `${base}?${new URLSearchParams({ start, days: String(days), ...o })}`;
  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Rooms left and the best available rate per type; drag a stay onto another room to move it."
        actions={
          <span className="inline-flex flex-wrap items-center gap-2 text-[13px]">
            <Link href={q({ start: addDays(start, -days) })}>Earlier</Link>
            <Link href={q({ start: addDays(p.businessDate, -1) })}>Today</Link>
            <Link href={q({ start: addDays(start, days) })}>Later</Link>
            {[7, 14, 30].map((d) => (
              <Link key={d} href={q({ days: String(d) })} className={`rounded-full border px-2.5 py-0.5 no-underline ${d === days ? "border-accent bg-accent-soft font-semibold text-accent-hover" : "border-line text-ink-2"}`}>{d} days</Link>
            ))}
          </span>
        }
      />
      <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
        {[["bg-[#2563eb]", "Confirmed"], ["bg-[#15803d]", "Checked in"], ["bg-[#f59e0b]", "Not confirmed"], ["bg-[#9ca3af]", "Checked out"], ["bg-[repeating-linear-gradient(45deg,#fee2e2,#fee2e2_3px,#fff_3px,#fff_6px)] border border-[#fecaca]", "Out of service"]].map(([c, l]) => (
          <span key={l} className="inline-flex items-center gap-1.5"><span className={`inline-block h-3 w-5 rounded ${c}`} aria-hidden="true" />{l}</span>
        ))}
      </div>
      <CalendarGrid data={data} slug={propertySlug} businessDate={p.businessDate} canMove={can(ctx, "reservations.manage")} />
    </>
  );
}
