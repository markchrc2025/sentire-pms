import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatPeso } from "@sentire-pms/core";
import { Badge, Card, Field, PageHeader, Select, Table } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { formatBp, listTaxFees } from "@/server/inventory/taxes";
import { saveTaxAction, taxActiveAction } from "../actions";

const BASIS: Record<string, string> = { PER_NIGHT: "Per night", PER_STAY: "Per stay", PER_GUEST_PER_NIGHT: "Per guest per night", PER_RESERVATION: "Per reservation" };
const KIND: Record<string, string> = { TAX: "Tax", FEE: "Fee", DISCOUNT: "Discount" };

export default async function TaxesPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { propertySlug } = await params;
  const { edit } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const items = await listTaxFees(getDb(), ctx);
  const manage = can(ctx, "settings.manage");
  const editing = edit ? items.find((t) => t.id === edit) : undefined;
  const base = `/p/${propertySlug}/settings/taxes`;
  const valueText = (t: (typeof items)[number]) => (t.calc === "PERCENT" ? formatBp(t.value) : formatPeso(t.value));
  const valueInput = (t: (typeof items)[number]) => (t.calc === "PERCENT" ? formatBp(t.value).replace("%", "") : (Number(t.value) / 100).toFixed(2));
  return (
    <>
      <PageHeader title="Taxes, fees and discounts" subtitle="Rates include 12% VAT by default. Each item posts to its GL account code." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <Table head={["Code", "Name", "Kind", "Value", "Applies", "In rate", "GL code", "Status", ""]}>
            {items.map((t) => (
              <tr key={t.id}>
                <td className="font-semibold">{t.code}</td>
                <td>{t.name}{t.system && <span className="ml-1.5 text-[11px] text-muted">built in</span>}</td>
                <td>{KIND[t.kind]}</td>
                <td>{valueText(t)}</td>
                <td>{BASIS[t.basis]}</td>
                <td>{t.inclusive ? "Included" : "Added"}</td>
                <td className="font-mono text-[12px]">{t.glCode}</td>
                <td>{t.active ? <Badge status="CLEAN">Active</Badge> : <Badge status="CHECKED_OUT">Off</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  {manage && (
                    <span className="inline-flex items-center gap-2">
                      <Link href={`${base}?edit=${t.id}`} className="text-[13px]">Edit</Link>
                      {!t.system && <ActionForm inline variant="secondary" action={taxActiveAction.bind(null, propertySlug, t.id, !t.active)} submitLabel={t.active ? "Turn off" : "Turn on"} />}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        {manage && (
          <Card title={editing ? `Edit ${editing.name}` : "Add a tax, fee or discount"} actions={editing ? <Link href={base} className="text-[13px]">Cancel</Link> : undefined}>
            <ActionForm key={editing?.id ?? "new"} action={saveTaxAction.bind(null, propertySlug, editing?.id ?? null)} submitLabel={editing ? "Save" : "Add"} resetOnOk={!editing}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code" name="code" defaultValue={editing?.code} required />
                <Select label="Kind" name="kind" options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} defaultValue={editing?.kind ?? "FEE"} />
                <Field label="Name" name="name" defaultValue={editing?.name} required className="col-span-2" />
                <Select label="Calculation" name="calc" options={[{ value: "PERCENT", label: "Percentage" }, { value: "FIXED", label: "Fixed peso amount" }]} defaultValue={editing?.calc ?? "FIXED"} />
                <Field label="Value" name="value" defaultValue={editing ? valueInput(editing) : ""} hint="12 for 12%, or 50.00 for ₱50.00" required />
                <Select label="Applies" name="basis" options={Object.entries(BASIS).map(([value, label]) => ({ value, label }))} defaultValue={editing?.basis ?? "PER_NIGHT"} className="col-span-2" />
                <Field label="GL account code" name="glCode" defaultValue={editing?.glCode} required />
                <label className="flex items-end gap-2 pb-2 text-[13px]">
                  <input type="checkbox" name="inclusive" defaultChecked={editing?.inclusive ?? false} /> Included in the rate
                </label>
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
