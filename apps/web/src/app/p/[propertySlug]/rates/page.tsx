import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { addDays, formatDate, formatDayShort, formatPeso, isIsoDate } from "@sentire-pms/core";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { availability } from "@/server/inventory/engine";
import { listRatePlans } from "@/server/rates/plans";
import { rateMatrix } from "@/server/rates/pricing";
import { getProperty } from "@/server/property";
import { saveDayAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RatesMatrix({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ plan?: string; start?: string; days?: string; edit?: string }> }) {
  const { propertySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const prop = await getProperty(db, ctx);
  const plans = await listRatePlans(db, ctx);
  if (!plans.length) {
    return (
      <>
        <PageHeader title="Availability matrix" />
        <Notice>No rate plans yet. {can(ctx, "rates.manage") ? <Link href={`/p/${propertySlug}/rates/plans`}>Add a policy and a rate plan</Link> : "Ask an Admin to add rate plans."}</Notice>
      </>
    );
  }
  const plan = plans.find((p) => p.plan.id === sp.plan)?.plan ?? plans[0]!.plan;
  const days = [7, 14, 30].includes(Number(sp.days)) ? Number(sp.days) : 14;
  const start = sp.start && isIsoDate(sp.start) ? sp.start : prop.businessDate;
  const end = addDays(start, days);
  const [matrix, avail] = await Promise.all([rateMatrix(db, ctx, plan.id, start, end), availability(db, ctx, start, end)]);
  const availBy = new Map(avail.map((a) => [a.roomTypeId, a]));
  const editable = can(ctx, "rates.manage") && plan.type === "STANDARD";
  const [editType, editDate] = (sp.edit ?? "").split("_");
  const editRow = matrix.find((m) => m.roomTypeId === editType);
  const editNight = editRow?.nights.find((n) => n.date === editDate);
  const base = `/p/${propertySlug}/rates`;
  const q = (o: Record<string, string>) => `${base}?${new URLSearchParams({ plan: plan.id, start, days: String(days), ...o })}`;
  const dates = matrix[0]?.nights.map((n) => n.date) ?? [];
  return (
    <>
      <PageHeader
        title="Availability matrix"
        subtitle={`${plan.name}${plan.type !== "STANDARD" ? " follows another plan; edit that plan's rates." : ""}`}
        actions={
          <>
            <Link className="text-[13px]" href={q({ start: addDays(start, -days) })}>Earlier</Link>
            <Link className="text-[13px]" href={q({ start: prop.businessDate })}>Business date</Link>
            <Link className="text-[13px]" href={q({ start: addDays(start, days) })}>Later</Link>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted">Plan:</span>
        {plans.map(({ plan: p }) => (
          <Link key={p.id} href={`${base}?${new URLSearchParams({ plan: p.id, start, days: String(days) })}`} aria-current={p.id === plan.id ? "true" : undefined} className={`rounded-full border px-2.5 py-1 no-underline ${p.id === plan.id ? "border-accent bg-accent-soft font-semibold text-accent-hover" : "border-line text-ink-2"}`}>
            {p.code}
          </Link>
        ))}
        <span className="ml-3 text-muted">Days:</span>
        {[7, 14, 30].map((d) => (
          <Link key={d} href={q({ days: String(d) })} className={`rounded-full border px-2.5 py-1 no-underline ${d === days ? "border-accent bg-accent-soft font-semibold text-accent-hover" : "border-line text-ink-2"}`}>{d}</Link>
        ))}
      </div>
      <Card className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[160px] border-b border-line bg-surface px-3 py-2 text-left text-[11px] uppercase text-muted">Room type</th>
              {dates.map((d) => (
                <th key={d} className={`min-w-[78px] border-b border-l border-line px-1.5 py-2 text-center font-semibold ${d === prop.businessDate ? "bg-accent-soft" : ""}`}>{formatDayShort(d)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => {
              const a = availBy.get(row.roomTypeId);
              return [
                <tr key={`${row.roomTypeId}-a`}>
                  <td className="sticky left-0 z-10 border-b border-line-soft bg-surface px-3 pt-2 font-semibold">{row.code} {row.name}<div className="text-[11px] font-normal text-muted">Rooms left</div></td>
                  {a?.days.map((d) => (
                    <td key={d.date} className={`border-l border-line-soft px-1.5 pt-2 text-center ${d.available <= 0 ? "font-semibold text-[#991b1b]" : "text-ink-2"}`}>{d.available}</td>
                  ))}
                </tr>,
                <tr key={`${row.roomTypeId}-r`}>
                  <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 pb-2 text-[11px] text-muted">Rate</td>
                  {row.nights.map((n) => {
                    const flags = [n.closed && "Closed", n.closedToArrival && "No arr.", n.closedToDeparture && "No dep.", n.minStay > 1 && `Min ${n.minStay}`, n.maxStay && `Max ${n.maxStay}`].filter(Boolean);
                    const cell = (
                      <>
                        <div className={n.closed ? "text-[#991b1b] line-through" : "font-semibold"}>{formatPeso(n.rateCentavos).replace(".00", "")}</div>
                        {flags.length > 0 && <div className="text-[10px] text-[#b45309]">{flags.join(", ")}</div>}
                      </>
                    );
                    return (
                      <td key={n.date} className={`border-b border-l border-line px-1 pb-2 text-center ${n.closed ? "bg-[repeating-linear-gradient(45deg,#fef2f2,#fef2f2_4px,#fff_4px,#fff_8px)]" : ""}`}>
                        {editable ? <Link href={q({ edit: `${row.roomTypeId}_${n.date}` })} className="block rounded px-0.5 text-ink no-underline hover:bg-surface-muted" aria-label={`Edit ${row.code} on ${formatDate(n.date)}`}>{cell}</Link> : cell}
                      </td>
                    );
                  })}
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </Card>
      {editable && editRow && editNight && (
        <Card title={`${editRow.code} ${editRow.name}, ${formatDate(editNight.date)}`} className="mt-5 max-w-[560px]" actions={<Link href={q({})} className="text-[13px]">Close</Link>}>
          <ActionForm key={sp.edit} action={saveDayAction.bind(null, propertySlug, plan.id, editRow.roomTypeId, editNight.date)} submitLabel="Save night">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Rate (₱)" name="rate" defaultValue={(Number(editNight.rateCentavos) / 100).toFixed(2)} hint="Empty: base rate" />
              <Field label="Minimum stay" name="minStay" type="number" min={1} max={365} defaultValue={editNight.minStay} />
              <Field label="Maximum stay" name="maxStay" type="number" min={1} max={365} defaultValue={editNight.maxStay ?? ""} hint="Empty: no limit" />
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="closed" defaultChecked={editNight.closed} /> Closed</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="closedToArrival" defaultChecked={editNight.closedToArrival} /> No arrivals</label>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="closedToDeparture" defaultChecked={editNight.closedToDeparture} /> No departures</label>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
