import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatPeso } from "@sentire-pms/core";
import { Card, Notice, PageHeader, Table } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { getReservation } from "@/server/reservations";
import { folioBalance } from "@/server/frontdesk";
import { getProperty } from "@/server/property";
import { checkOutAction } from "../frontdesk-actions";

export const dynamic = "force-dynamic";

export default async function CheckOutPage({ params }: { params: Promise<{ propertySlug: string; id: string }> }) {
  const { propertySlug, id } = await params;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const [{ reservation: r, guest: g, rooms, nights }, p] = await Promise.all([getReservation(db, ctx, id), getProperty(db, ctx)]);
  const balance = await folioBalance(db, ctx, id);
  const base = `/p/${propertySlug}/reservations/${id}`;
  if (!can(ctx, "reservations.manage")) return <Notice kind="warn">Your role cannot check guests out.</Notice>;
  const early = r.checkOut > p.businessDate;
  return (
    <>
      <PageHeader title={`Check out ${g.firstName} ${g.lastName}`} subtitle={`${r.code}, ${formatDate(r.checkIn)} to ${formatDate(r.checkOut)}`} actions={<Link href={base} className="text-[13px]">Back to the reservation</Link>} />
      {r.status !== "CHECKED_IN" && <div className="mb-4"><Notice kind="warn">Only a checked-in stay can be checked out.</Notice></div>}
      {early && r.status === "CHECKED_IN" && <div className="mb-4"><Notice kind="warn">Early departure: the booked departure is {formatDate(r.checkOut)}. Nights from {formatDate(p.businessDate > r.checkIn ? p.businessDate : r.checkIn)} on are given back.</Notice></div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Stay">
          <Table head={["Night", "Room", "Rate"]}>
            {nights.map((n) => (
              <tr key={n.id}>
                <td>{formatDate(n.stayDate)}</td>
                <td>{rooms.find((x) => x.rr.id === n.reservationRoomId)?.roomNumber ?? ""}</td>
                <td>{formatPeso(n.rateCentavos)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Balance">
          <div className="text-[28px] font-bold">{formatPeso(balance)}</div>
          <p className="text-[12px] text-muted">Folios, payments and the BIR invoice arrive in Phase 6. Until then the balance is ₱0.00 and check-out only needs the guest to leave.</p>
          {r.status === "CHECKED_IN" && (
            <ActionForm action={checkOutAction.bind(null, propertySlug, id)} submitLabel="Check out" confirm="Check this guest out? The rooms become Dirty for housekeeping.">
              <p className="m-0 text-[12px] text-muted">The rooms are marked Dirty for housekeeping.</p>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
