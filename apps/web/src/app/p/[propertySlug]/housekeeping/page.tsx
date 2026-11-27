import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate } from "@sentire-pms/core";
import { PageHeader, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { FD_LABEL, housekeepingBoard, type FrontDeskStatus } from "@/server/frontdesk";
import { conditionAction, housekeeperAction } from "./actions";

export const dynamic = "force-dynamic";

const COND = { DIRTY: { label: "Dirty", cls: "border-[#fcd34d] bg-[#fffbeb]", dot: "bg-[#d97706]" }, CLEAN: { label: "Clean", cls: "border-[#bbf7d0] bg-[#f0fdf4]", dot: "bg-[#16a34a]" }, INSPECTED: { label: "Inspected", cls: "border-[#bfdbfe] bg-[#eff6ff]", dot: "bg-[#2563eb]" } } as const;
const FD_CLS: Record<FrontDeskStatus, string> = { ARRIVAL: "bg-[#eff6ff] text-[#1d4ed8]", DEPARTURE: "bg-[#fef3c7] text-[#92400e]", TURNOVER: "bg-[#fae8ff] text-[#86198f]", STAYOVER: "bg-[#f0fdf4] text-[#166534]", OCCUPIED: "bg-[#f0fdf4] text-[#166534]", VACANT: "bg-[#f3f4f6] text-ink-2", OUT_OF_SERVICE: "bg-[#fef2f2] text-[#991b1b]" };

export default async function HousekeepingPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ condition?: string; status?: string; mine?: string }> }) {
  const { propertySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const board = await housekeepingBoard(getDb(), ctx);
  const canUpdate = can(ctx, "housekeeping.update");
  const canAssign = can(ctx, "property.manage");
  const rooms = board.rooms.filter((r) => (!sp.condition || r.condition === sp.condition) && (!sp.status || r.status === sp.status) && (!sp.mine || r.housekeeperUserId === ctx.userId));
  const base = `/p/${propertySlug}/housekeeping`;
  const chip = (k: string, v: string | undefined, label: string, active: boolean) => {
    const u = new URLSearchParams(Object.entries({ ...sp, [k]: v }).filter(([, x]) => x) as [string, string][]);
    return <Link key={`${k}${v}`} href={`${base}?${u}`} className={`rounded-full border px-3 py-1.5 text-[13px] no-underline ${active ? "border-accent bg-accent-soft font-semibold text-accent-hover" : "border-line text-ink-2"}`}>{label}</Link>;
  };
  const counts = { DIRTY: 0, CLEAN: 0, INSPECTED: 0 };
  for (const r of board.rooms) counts[r.condition]++;
  return (
    <>
      <PageHeader title="Housekeeping" subtitle={`Business date ${formatDate(board.businessDate)}. ${counts.DIRTY} dirty, ${counts.CLEAN} clean, ${counts.INSPECTED} inspected.`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip("condition", undefined, "All", !sp.condition)}
        {(["DIRTY", "CLEAN", "INSPECTED"] as const).map((c) => chip("condition", c, COND[c].label, sp.condition === c))}
        <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
        {chip("status", undefined, "Any status", !sp.status)}
        {(["DEPARTURE", "TURNOVER", "ARRIVAL", "STAYOVER", "VACANT"] as const).map((s) => chip("status", s, FD_LABEL[s], sp.status === s))}
        <span className="mx-2 h-5 w-px bg-line" aria-hidden="true" />
        {chip("mine", sp.mine ? undefined : "1", "My rooms", Boolean(sp.mine))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
        {rooms.map((r) => (
          <section key={r.id} aria-label={`Room ${r.number}`} className={`flex flex-col gap-2 rounded-card border p-3.5 ${COND[r.condition].cls}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[20px] font-bold leading-tight">{r.number}</div>
                <div className="text-[12px] text-muted">{r.typeCode} {r.typeName}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${FD_CLS[r.status]}`}>{FD_LABEL[r.status]}</span>
            </div>
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <span className={`h-2.5 w-2.5 rounded-full ${COND[r.condition].dot}`} aria-hidden="true" />
              {COND[r.condition].label}
              {r.conditionChangedAt && <span className="text-[11px] font-normal text-muted">since {formatDateTime(r.conditionChangedAt)}</span>}
            </div>
            {r.guest && <div className="text-[12px] text-ink-2">{r.guest}</div>}
            {canUpdate && (
              <div className="grid grid-cols-3 gap-1.5">
                {(["DIRTY", "CLEAN", "INSPECTED"] as const).map((c) => (
                  <ActionForm key={c} inline variant={r.condition === c ? "primary" : "secondary"} action={conditionAction.bind(null, propertySlug, r.id, c)} submitLabel={COND[c].label} className="[&_button]:h-11 [&_button]:w-full [&_button]:justify-center [&_button]:px-1 [&>div]:w-full" />
                ))}
              </div>
            )}
            {canAssign ? (
              <ActionForm inline variant="secondary" action={housekeeperAction.bind(null, propertySlug, r.id)} submitLabel="Set">
                <label className="sr-only" htmlFor={`hk-${r.id}`}>Housekeeper for room {r.number}</label>
                <select id={`hk-${r.id}`} name="userId" defaultValue={r.housekeeperUserId ?? ""} className="h-8 w-[140px] rounded-control border border-line bg-surface px-2 text-[12px]">
                  <option value="">No housekeeper</option>
                  {board.housekeepers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </ActionForm>
            ) : (
              <div className="text-[12px] text-muted">{r.housekeeperName ? `Housekeeper: ${r.housekeeperName}` : "No housekeeper"}</div>
            )}
          </section>
        ))}
      </div>
      {!rooms.length && <p className="text-[13px] text-muted">No rooms match.</p>}
    </>
  );
}
