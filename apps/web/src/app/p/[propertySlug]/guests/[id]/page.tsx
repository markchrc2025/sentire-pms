import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatPeso, STATUS_LABEL } from "@sentire-pms/core";
import { Badge, Card, PageHeader, Table } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { getGuest } from "@/server/guests";
import { saveGuestAction } from "../actions";
import { GuestFields } from "../GuestFields";

export default async function GuestPage({ params }: { params: Promise<{ propertySlug: string; id: string }> }) {
  const { propertySlug, id } = await params;
  const ctx = await requireTenant(propertySlug);
  const { guest: g, stays } = await getGuest(getDb(), ctx, id);
  return (
    <>
      <PageHeader title={`${g.firstName} ${g.lastName}`} subtitle={[g.email, g.mobile].filter(Boolean).join(", ")} actions={<Link href={`/p/${propertySlug}/guests`} className="text-[13px]">All guests</Link>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Details">
          {can(ctx, "guests.manage") ? (
            <ActionForm action={saveGuestAction.bind(null, propertySlug, g.id)} submitLabel="Save guest">
              <GuestFields g={g} />
            </ActionForm>
          ) : (
            <GuestFields g={g} />
          )}
          {g.idNumber && <p className="mb-0 mt-3 text-[13px]">ID on file: {g.idType} {g.idNumber}</p>}
        </Card>
        <Card title="Stays">
          <Table head={["Code", "Arrival", "Departure", "Status", "Total"]} empty={stays.length ? undefined : "No stays yet."}>
            {stays.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/p/${propertySlug}/reservations/${r.id}`} className="font-mono font-semibold">{r.code}</Link></td>
                <td>{formatDate(r.checkIn)}</td>
                <td>{formatDate(r.checkOut)}</td>
                <td><Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge></td>
                <td>{formatPeso(r.totalCentavos)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
