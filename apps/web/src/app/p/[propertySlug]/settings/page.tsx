import { getDb } from "@sentire-pms/db";
import { formatDate } from "@sentire-pms/core";
import { Card, Field, Notice, PageHeader } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { getProperty } from "@/server/property";
import { savePropertyAction } from "./actions";

export default async function PropertySettings({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  const p = await getProperty(getDb(), ctx);
  const editable = can(ctx, "property.manage");
  return (
    <>
      <PageHeader title="Property" subtitle={`Business date ${formatDate(p.businessDate)}. It changes only when night audit runs.`} />
      <Card className="max-w-[760px]">
        {!editable && <div className="mb-3"><Notice>You can view these details. Only an Owner or Admin can change them.</Notice></div>}
        <ActionForm action={savePropertyAction.bind(null, propertySlug)} submitLabel="Save property">
          <fieldset disabled={!editable} className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
            <Field label="Property name" name="name" defaultValue={p.name} required className="sm:col-span-2" />
            <Field label="Registered business name" name="registeredName" defaultValue={p.registeredName ?? ""} hint="As printed on BIR invoices" className="sm:col-span-2" />
            <Field label="TIN" name="tin" defaultValue={p.tin ?? ""} placeholder="000-000-000-00000" />
            <Field label="Branch code" name="branchCode" defaultValue={p.branchCode ?? ""} placeholder="00000" />
            <Field label="Address" name="address" defaultValue={p.address ?? ""} className="sm:col-span-2" />
            <Field label="Time zone" name="timezone" defaultValue={p.timezone} />
            <Field label="Currency" name="currencyShown" defaultValue={p.currency} disabled hint="Philippine peso only" />
            <Field label="Check-in time" name="checkInTime" type="time" defaultValue={p.checkInTime.slice(0, 5)} />
            <Field label="Check-out time" name="checkOutTime" type="time" defaultValue={p.checkOutTime.slice(0, 5)} />
          </fieldset>
        </ActionForm>
      </Card>
    </>
  );
}
