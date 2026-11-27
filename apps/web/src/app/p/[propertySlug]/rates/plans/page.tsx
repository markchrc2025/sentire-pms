import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatPeso } from "@sentire-pms/core";
import { Badge, Card, Field, PageHeader, Select, Table, TextArea } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { listRatePlans, PLAN_TYPE_LABEL } from "@/server/rates/plans";
import { listPolicies } from "@/server/rates/policies";
import { formatBp } from "@/server/inventory/taxes";
import { planActiveAction, savePlanAction } from "../actions";

type PlanRow = Awaited<ReturnType<typeof listRatePlans>>[number]["plan"];

function rule(p: PlanRow, parentCode?: string) {
  if (p.type === "STANDARD") return "Own daily rates";
  if (p.type === "PACKAGE") return `${parentCode} + ${formatPeso(p.packageAddCentavos)} a night`;
  const v = p.adjustKind === "PERCENT" ? formatBp(p.adjustValue < 0n ? -p.adjustValue : p.adjustValue) : formatPeso(p.adjustValue < 0n ? -p.adjustValue : p.adjustValue);
  return `${parentCode} ${p.adjustValue < 0n ? "minus" : "plus"} ${v}`;
}
function adjustInput(p: PlanRow) {
  if (p.adjustKind === "PERCENT") return (p.adjustValue < 0n ? "-" : "") + formatBp(p.adjustValue < 0n ? -p.adjustValue : p.adjustValue).replace("%", "");
  return (Number(p.adjustValue) / 100).toFixed(2);
}

export default async function PlansPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { propertySlug } = await params;
  const { edit } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const [plans, pols] = await Promise.all([listRatePlans(db, ctx, { includeInactive: true }), listPolicies(db, ctx)]);
  const manage = can(ctx, "rates.manage");
  const codeOf = new Map(plans.map((p) => [p.plan.id, p.plan.code]));
  const editing = edit ? plans.find((p) => p.plan.id === edit)?.plan : undefined;
  const base = `/p/${propertySlug}/rates/plans`;
  const standards = plans.filter((p) => p.plan.type === "STANDARD" && p.plan.active && p.plan.id !== editing?.id);
  return (
    <>
      <PageHeader title="Rate plans" subtitle="Standard plans hold daily rates. Derived plans follow a standard plan up or down; packages add included items." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <Table head={["Code", "Name", "Type", "Rate rule", "Policy", "Online", "Status", ""]} empty={plans.length ? undefined : "No rate plans yet."}>
            {plans.map(({ plan: p, policyName }) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.code}</td>
                <td>{p.name}{p.inclusions && <div className="text-[11px] text-muted">Includes: {p.inclusions}</div>}</td>
                <td>{PLAN_TYPE_LABEL[p.type]}</td>
                <td>{rule(p, p.parentId ? codeOf.get(p.parentId) : undefined)}</td>
                <td>{policyName}</td>
                <td>{p.sellOnline ? "Yes" : "No"}</td>
                <td>{p.active ? <Badge status="CLEAN">Active</Badge> : <Badge status="CHECKED_OUT">Off</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  {manage && (
                    <span className="inline-flex items-center gap-2">
                      <Link href={`${base}?edit=${p.id}`} className="text-[13px]">Edit</Link>
                      <ActionForm inline variant="secondary" action={planActiveAction.bind(null, propertySlug, p.id, !p.active)} submitLabel={p.active ? "Turn off" : "Turn on"} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        {manage && pols.length > 0 && (
          <Card title={editing ? `Edit ${editing.name}` : "Add a rate plan"} actions={editing ? <Link href={base} className="text-[13px]">Cancel</Link> : undefined}>
            <ActionForm key={editing?.id ?? "new"} action={savePlanAction.bind(null, propertySlug, editing?.id ?? null)} submitLabel={editing ? "Save plan" : "Add plan"} resetOnOk={!editing}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code" name="code" defaultValue={editing?.code} required />
                <Select label="Type" name="type" options={Object.entries(PLAN_TYPE_LABEL).map(([value, label]) => ({ value, label }))} defaultValue={editing?.type ?? "STANDARD"} />
                <Field label="Name" name="name" defaultValue={editing?.name} required className="col-span-2" />
                <Select label="Follows (derived and package)" name="parentId" options={[{ value: "", label: "None" }, ...standards.map((p) => ({ value: p.plan.id, label: `${p.plan.code} ${p.plan.name}` }))]} defaultValue={editing?.parentId ?? ""} className="col-span-2" />
                <Select label="Derived: adjust by" name="adjustKind" options={[{ value: "PERCENT", label: "Percent" }, { value: "FIXED", label: "Peso amount" }]} defaultValue={editing?.adjustKind ?? "PERCENT"} />
                <Field label="Derived: value" name="adjustValue" defaultValue={editing ? adjustInput(editing) : ""} hint="-10 means 10% or ₱10 cheaper" />
                <Field label="Package: add per night (₱)" name="packageAdd" defaultValue={editing ? (Number(editing.packageAddCentavos) / 100).toFixed(2) : ""} />
                <Select label="Policy" name="policyId" options={pols.filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }))} defaultValue={editing?.policyId} />
                <TextArea label="Package: what is included" name="inclusions" defaultValue={editing?.inclusions ?? ""} className="col-span-2" />
                <Field label="Sort order" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
                <label className="flex items-end gap-2 pb-2 text-[13px]"><input type="checkbox" name="sellOnline" defaultChecked={editing?.sellOnline ?? true} /> Sell online</label>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
