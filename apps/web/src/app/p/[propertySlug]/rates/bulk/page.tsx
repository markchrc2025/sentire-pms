import { getDb } from "@sentire-pms/db";
import { addDays } from "@sentire-pms/core";
import { Card, Field, Notice, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { listRatePlans } from "@/server/rates/plans";
import { listRoomTypes } from "@/server/inventory/rooms";
import { getProperty } from "@/server/property";
import { bulkAction } from "../actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TRI = [{ value: "", label: "Leave as is" }, { value: "on", label: "Set" }, { value: "off", label: "Clear" }];

export default async function BulkPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "rates.manage")) return <Notice kind="warn">Only an Owner or Admin can change rates.</Notice>;
  const db = getDb();
  const [plans, types, prop] = await Promise.all([listRatePlans(db, ctx), listRoomTypes(db, ctx), getProperty(db, ctx)]);
  const standard = plans.filter((p) => p.plan.type === "STANDARD");
  const btn = "inline-flex h-9 items-center rounded-control border px-3.5 text-[13px] font-semibold";
  return (
    <>
      <PageHeader title="Bulk update" subtitle="Change rates and restrictions for many nights at once. Preview first; Apply saves every night in one go, or none." />
      <Card className="max-w-[820px]">
        <ActionForm
          action={bulkAction.bind(null, propertySlug)}
          buttons={
            <>
              <button type="submit" name="intent" value="preview" className={`${btn} border-line bg-surface text-ink hover:bg-surface-muted`}>Preview</button>
              <button type="submit" name="intent" value="apply" className={`${btn} border-transparent bg-accent text-white hover:bg-accent-hover`}>Apply</button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Rate plan" name="ratePlanId" options={standard.map((p) => ({ value: p.plan.id, label: `${p.plan.code} ${p.plan.name}` }))} />
            <Field label="From" name="from" type="date" defaultValue={prop.businessDate} required />
            <Field label="To (including)" name="to" type="date" defaultValue={addDays(prop.businessDate, 30)} required />
          </div>
          <fieldset className="m-0 rounded-control border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold">Days of the week</legend>
            <div className="flex flex-wrap gap-3 text-[13px]">
              {DAYS.map((d, i) => <label key={d} className="flex items-center gap-1.5"><input type="checkbox" name="days" value={i} defaultChecked /> {d}</label>)}
            </div>
          </fieldset>
          <fieldset className="m-0 rounded-control border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold">Room types</legend>
            <div className="flex flex-wrap gap-3 text-[13px]">
              {types.map((t) => <label key={t.id} className="flex items-center gap-1.5"><input type="checkbox" name="roomTypeIds" value={t.id} defaultChecked /> {t.code} {t.name}</label>)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Rate" name="rateAction" options={[{ value: "", label: "Leave as is" }, { value: "SET", label: "Set to" }, { value: "INCREASE", label: "Increase by" }, { value: "DECREASE", label: "Decrease by" }]} />
            <Select label="By" name="rateMode" options={[{ value: "AMOUNT", label: "Peso amount" }, { value: "PERCENT", label: "Percent" }]} />
            <Field label="Value" name="rateValue" placeholder="3500 or 10" />
            <Field label="Minimum stay" name="minStay" type="number" min={1} max={365} hint="Empty: leave as is" />
            <Field label="Maximum stay" name="maxStay" hint="Empty: leave; 'none' removes it" />
            <span />
            <Select label="Closed" name="closed" options={TRI} />
            <Select label="No arrivals" name="closedToArrival" options={TRI} />
            <Select label="No departures" name="closedToDeparture" options={TRI} />
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
