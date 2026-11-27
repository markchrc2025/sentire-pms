import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { Badge, Card, Field, PageHeader, Select, Table, TextArea } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { CHARGE_LABEL, listPolicies } from "@/server/rates/policies";
import { formatBp } from "@/server/inventory/taxes";
import { policyActiveAction, savePolicyAction } from "../actions";

const KINDS = Object.entries(CHARGE_LABEL).map(([value, label]) => ({ value, label }));
const charge = (k: keyof typeof CHARGE_LABEL, v: bigint) => (k === "PERCENT" ? `${formatBp(v)} of the stay` : CHARGE_LABEL[k]);
const pct = (v: bigint) => (v ? formatBp(v).replace("%", "") : "");

export default async function PoliciesPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { propertySlug } = await params;
  const { edit } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const pols = await listPolicies(getDb(), ctx);
  const manage = can(ctx, "rates.manage");
  const editing = edit ? pols.find((p) => p.id === edit) : undefined;
  const base = `/p/${propertySlug}/rates/policies`;
  return (
    <>
      <PageHeader title="Policies" subtitle="Deposit to confirm, free cancellation window, and penalties for late cancellation and no-show. Each rate plan has one." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <Table head={["Name", "Deposit", "Free cancellation", "Late cancellation", "No-show", "Status", ""]} empty={pols.length ? undefined : "No policies yet."}>
            {pols.map((p) => (
              <tr key={p.id}>
                <td className="font-semibold">{p.name}{p.description && <div className="text-[11px] font-normal text-muted">{p.description}</div>}</td>
                <td>{charge(p.guarantee, p.guaranteeValue)}</td>
                <td>{p.freeCancelHours === null ? "Non-refundable" : `Until ${p.freeCancelHours} hours before arrival`}</td>
                <td>{charge(p.lateCancelPenalty, p.lateCancelValue)}</td>
                <td>{charge(p.noShowPenalty, p.noShowValue)}</td>
                <td>{p.active ? <Badge status="CLEAN">Active</Badge> : <Badge status="CHECKED_OUT">Off</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  {manage && (
                    <span className="inline-flex items-center gap-2">
                      <Link href={`${base}?edit=${p.id}`} className="text-[13px]">Edit</Link>
                      <ActionForm inline variant="secondary" action={policyActiveAction.bind(null, propertySlug, p.id, !p.active)} submitLabel={p.active ? "Turn off" : "Turn on"} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        {manage && (
          <Card title={editing ? `Edit ${editing.name}` : "Add a policy"} actions={editing ? <Link href={base} className="text-[13px]">Cancel</Link> : undefined}>
            <ActionForm key={editing?.id ?? "new"} action={savePolicyAction.bind(null, propertySlug, editing?.id ?? null)} submitLabel={editing ? "Save policy" : "Add policy"} resetOnOk={!editing}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name" name="name" defaultValue={editing?.name} required className="col-span-2" />
                <Select label="Deposit to confirm" name="guarantee" options={KINDS} defaultValue={editing?.guarantee ?? "FIRST_NIGHT"} />
                <Field label="Deposit %" name="guaranteeValue" defaultValue={editing ? pct(editing.guaranteeValue) : ""} hint="When a percentage" />
                <label className="col-span-2 flex items-center gap-2 text-[13px]"><input type="checkbox" name="refundable" defaultChecked={editing ? editing.freeCancelHours !== null : true} /> Free cancellation allowed</label>
                <Field label="Free until hours before arrival" name="freeCancelHours" type="number" min={0} max={8760} defaultValue={editing?.freeCancelHours ?? 48} />
                <Field label="Hold unconfirmed (hours)" name="holdHours" type="number" min={0} max={720} defaultValue={editing?.holdHours ?? 0} hint="0: no automatic release" />
                <Select label="Late cancellation" name="lateCancelPenalty" options={KINDS} defaultValue={editing?.lateCancelPenalty ?? "FIRST_NIGHT"} />
                <Field label="Late cancellation %" name="lateCancelValue" defaultValue={editing ? pct(editing.lateCancelValue) : ""} />
                <Select label="No-show" name="noShowPenalty" options={KINDS} defaultValue={editing?.noShowPenalty ?? "FIRST_NIGHT"} />
                <Field label="No-show %" name="noShowValue" defaultValue={editing ? pct(editing.noShowValue) : ""} />
                <TextArea label="Wording for guests" name="description" defaultValue={editing?.description ?? ""} className="col-span-2" />
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
