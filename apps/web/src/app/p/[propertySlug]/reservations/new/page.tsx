import { addDays } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { Notice, PageHeader } from "@/components/ui";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { getProperty } from "@/server/property";
import { SOURCES } from "@/server/reservations";
import { NewReservation } from "./NewReservation";

export default async function NewReservationPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "reservations.manage")) return <Notice kind="warn">Your role cannot make reservations.</Notice>;
  const p = await getProperty(getDb(), ctx);
  return (
    <>
      <PageHeader title="New reservation" subtitle="Pick dates, choose rooms and rates, then add the guest." />
      <NewReservation slug={propertySlug} businessDate={p.businessDate} tomorrow={addDays(p.businessDate, 1)} sources={Object.entries(SOURCES).map(([value, label]) => ({ value, label }))} canOverbook={can(ctx, "property.manage")} canIgnoreRestrictions={can(ctx, "rates.manage")} />
    </>
  );
}
