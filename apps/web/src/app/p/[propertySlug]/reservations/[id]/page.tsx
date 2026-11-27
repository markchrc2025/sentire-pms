import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatPeso, nightsBetween, STATUS_LABEL, TRANSITIONS } from "@sentire-pms/core";
import { Badge, Card, Field, Notice, PageHeader, Select, Table, TextArea, formatDateTime } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { activityLog, cancellationPreview, freeRoomsFor, getReservation, SOURCES } from "@/server/reservations";
import { listFiles } from "@/server/files";
import { listRatePlans } from "@/server/rates/plans";
import { listRoomTypes } from "@/server/inventory/rooms";
import { getProperty } from "@/server/property";
import { addRoomAction, assignAction, changeDatesAction, changeRoomAction, infoAction, noteAction, removeRoomAction, transitionAction, uploadAction } from "../actions";

export const dynamic = "force-dynamic";

const ACTION_TEXT: Record<string, string> = {
  "reservation.create": "Reservation made",
  "reservation.confirmed": "Confirmed",
  "reservation.not_confirmed": "Booked as not confirmed",
  "reservation.checked_in": "Checked in",
  "reservation.checked_out": "Checked out",
  "reservation.cancelled": "Cancelled",
  "reservation.no_show": "Marked as no-show",
  "reservation.change_dates": "Dates changed",
  "reservation.update": "Details changed",
  "reservation.totals": "Totals updated",
  "reservation_room.create": "Room added",
  "reservation_room.change": "Room type, plan or guests changed",
  "reservation_room.remove": "Room removed",
  "reservation_room.assign": "Room assigned",
  "reservation_room.unassign": "Room unassigned",
  "reservation_note.create": "Note added",
  "file.reservation_doc": "Document uploaded",
};

export default async function ReservationPage({ params }: { params: Promise<{ propertySlug: string; id: string }> }) {
  const { propertySlug, id } = await params;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const [data, activity, files, prop] = await Promise.all([getReservation(db, ctx, id), activityLog(db, ctx, id), listFiles(db, ctx, id), getProperty(db, ctx)]);
  const { reservation: r, guest, rooms, nights, notes } = data;
  const manage = can(ctx, "reservations.manage");
  const next = TRANSITIONS[r.status];
  const live = ["INQUIRY", "NOT_CONFIRMED", "CONFIRMED"].includes(r.status);
  const preview = next.includes("CANCELLED") ? (await cancellationPreview(db, ctx, id)).penaltyCentavos : 0n;
  const [plans, types] = live && manage ? await Promise.all([listRatePlans(db, ctx), listRoomTypes(db, ctx)]) : [[], []];
  const free = new Map<string, Awaited<ReturnType<typeof freeRoomsFor>>>();
  if (manage && ["NOT_CONFIRMED", "CONFIRMED", "CHECKED_IN"].includes(r.status)) for (const x of rooms) if (x.rr.active) free.set(x.rr.id, await freeRoomsFor(db, ctx, x.rr.id));
  const nightsCount = nightsBetween(r.checkIn, r.checkOut).length;
  const base = `/p/${propertySlug}`;
  return (
    <>
      <PageHeader
        title={`${guest.firstName} ${guest.lastName}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold text-ink">{r.code}</span>
            <Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge>
            <span>{formatDate(r.checkIn)} to {formatDate(r.checkOut)}, {nightsCount} night{nightsCount > 1 ? "s" : ""}</span>
            <span>{SOURCES[r.source]}</span>
          </span>
        }
        actions={<Link href={`${base}/reservations`} className="text-[13px]">All reservations</Link>}
      />
      {r.status === "NOT_CONFIRMED" && r.holdUntil && <div className="mb-4"><Notice kind="warn">Held until {formatDateTime(r.holdUntil)} while waiting for the deposit of {formatPeso(r.guaranteeCentavos)}.</Notice></div>}
      {r.penaltyCentavos > 0n && <div className="mb-4"><Notice kind="warn">Policy penalty: {formatPeso(r.penaltyCentavos)}. It is posted to the folio once folios arrive (Phase 6).</Notice></div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Card title="Rooms">
            <Table head={["Room type", "Rate plan", "Guests", "Room", "Total", ""]}>
              {rooms.map((x) => (
                <tr key={x.rr.id}>
                  <td className="font-semibold">{x.typeCode} {x.typeName}</td>
                  <td>{x.planCode}</td>
                  <td>{x.rr.adults} adult{x.rr.adults > 1 ? "s" : ""}{x.rr.children ? `, ${x.rr.children} child${x.rr.children > 1 ? "ren" : ""}` : ""}</td>
                  <td>
                    {free.has(x.rr.id) ? (
                      <ActionForm inline showOk variant="secondary" action={assignAction.bind(null, propertySlug, x.rr.id)} submitLabel="Save">
                        <label className="sr-only" htmlFor={`room-${x.rr.id}`}>Room for {x.typeName}</label>
                        <select id={`room-${x.rr.id}`} name="roomId" defaultValue={x.rr.roomId ?? ""} className="h-8 rounded-control border border-line px-2 text-[12px]">
                          {r.status !== "CHECKED_IN" && <option value="">Not assigned</option>}
                          {x.rr.roomId && <option value={x.rr.roomId}>{x.roomNumber} (current)</option>}
                          {free.get(x.rr.id)!.filter((f) => f.id !== x.rr.roomId).map((f) => <option key={f.id} value={f.id}>{f.number}{f.condition === "DIRTY" ? " (dirty)" : ""}</option>)}
                        </select>
                      </ActionForm>
                    ) : (
                      x.roomNumber ?? <span className="text-muted">Not assigned</span>
                    )}
                  </td>
                  <td>{formatPeso(x.rr.totalCentavos)}</td>
                  <td className="text-right">{live && manage && rooms.length > 1 && <ActionForm inline variant="danger" action={removeRoomAction.bind(null, propertySlug, x.rr.id)} submitLabel="Remove" confirm="Remove this room from the reservation?" />}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-3 flex justify-end gap-6 text-[13px]">
              <span>Room charges <b>{formatPeso(r.totalCentavos)}</b></span>
              <span className="text-muted">Deposit to confirm {formatPeso(r.guaranteeCentavos)}</span>
            </div>
            {live && manage && rooms.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[13px] font-semibold">Change a room or add one</summary>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  {rooms.map((x) => (
                    <ActionForm key={x.rr.id} action={changeRoomAction.bind(null, propertySlug, x.rr.id)} submitLabel={`Change ${x.typeCode}`} className="rounded-control border border-line p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Select label="Room type" name="roomTypeId" options={types.map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }))} defaultValue={x.rr.roomTypeId} />
                        <Select label="Rate plan" name="ratePlanId" options={plans.map((p) => ({ value: p.plan.id, label: p.plan.code }))} defaultValue={x.rr.ratePlanId} />
                        <Field label="Adults" name="adults" type="number" min={1} defaultValue={x.rr.adults} />
                        <Field label="Children" name="children" type="number" min={0} defaultValue={x.rr.children} />
                      </div>
                    </ActionForm>
                  ))}
                  <ActionForm action={addRoomAction.bind(null, propertySlug, r.id)} submitLabel="Add room" className="rounded-control border border-dashed border-line p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Select label="Room type" name="roomTypeId" options={types.map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }))} />
                      <Select label="Rate plan" name="ratePlanId" options={plans.map((p) => ({ value: p.plan.id, label: p.plan.code }))} />
                      <Field label="Adults" name="adults" type="number" min={1} defaultValue={2} />
                      <Field label="Children" name="children" type="number" min={0} defaultValue={0} />
                    </div>
                  </ActionForm>
                </div>
              </details>
            )}
          </Card>

          <Card title="Nightly rates">
            <div className="flex flex-wrap gap-2 text-[12px]">
              {nights.map((n) => (
                <span key={n.id} className="rounded-control border border-line px-2 py-1">{formatDate(n.stayDate)}: <b>{formatPeso(n.rateCentavos)}</b></span>
              ))}
              {!nights.length && <span className="text-muted">No nights held (inquiry or ended booking).</span>}
            </div>
          </Card>

          <Card title="Notes">
            {manage && (
              <ActionForm action={noteAction.bind(null, propertySlug, r.id)} submitLabel="Add note" resetOnOk>
                <TextArea label="New note" name="body" />
              </ActionForm>
            )}
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {notes.map((n) => (
                <li key={n.id} className="rounded-control border border-line-soft p-2.5 text-[13px]">
                  <div className="whitespace-pre-wrap">{n.body}</div>
                  <div className="mt-1 text-[11px] text-muted">{n.author ?? "Someone"}, {formatDateTime(new Date(n.created_at))}</div>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Documents">
            {manage && (
              <ActionForm action={uploadAction.bind(null, propertySlug, r.id)} submitLabel="Upload" resetOnOk inline>
                <label className="sr-only" htmlFor="doc-file">Document</label>
                <input id="doc-file" type="file" name="file" accept="application/pdf,image/*" className="text-[13px]" />
              </ActionForm>
            )}
            <ul className="m-0 mt-3 list-none p-0 text-[13px]">
              {files.map((f) => (
                <li key={f.id} className="py-1"><a href={`${base}/files/${f.id}`} target="_blank" rel="noreferrer">{f.fileName}</a> <span className="text-muted">{Math.ceil(f.sizeBytes / 1024)} KB, {formatDateTime(f.createdAt)}</span></li>
              ))}
              {!files.length && <li className="text-muted">No documents. Files stay on the hub.</li>}
            </ul>
          </Card>

          <Card title="Activity">
            <ul className="m-0 list-none p-0 text-[13px]">
              {activity.map((a, i) => (
                <li key={i} className="flex gap-3 border-b border-line-soft py-1.5 last:border-0">
                  <span className="w-[170px] shrink-0 text-muted">{formatDateTime(new Date(a.at))}</span>
                  <span>{ACTION_TEXT[a.action] ?? a.action}{a.actor ? `, by ${a.actor}` : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {manage && next.length > 0 && (
            <Card title="Status">
              <div className="flex flex-col gap-3">
                {next.includes("CONFIRMED") && <ActionForm action={transitionAction.bind(null, propertySlug, r.id, "CONFIRMED")} submitLabel="Confirm" />}
                {next.includes("NOT_CONFIRMED") && <ActionForm variant="secondary" action={transitionAction.bind(null, propertySlug, r.id, "NOT_CONFIRMED")} submitLabel="Book (not confirmed)" />}
                {next.includes("CHECKED_IN") && r.status === "CONFIRMED" && <Link href={`${base}/reservations/${r.id}/check-in`} className="inline-flex h-9 items-center justify-center rounded-control bg-accent px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-accent-hover hover:text-white">Check in</Link>}
                {next.includes("CHECKED_IN") && r.status === "CHECKED_OUT" && <ActionForm variant="secondary" action={transitionAction.bind(null, propertySlug, r.id, "CHECKED_IN")} submitLabel="Reopen stay" />}
                {next.includes("CHECKED_OUT") && <Link href={`${base}/reservations/${r.id}/check-out`} className="inline-flex h-9 items-center justify-center rounded-control bg-accent px-3.5 text-[13px] font-semibold text-white no-underline hover:bg-accent-hover hover:text-white">Check out</Link>}
                {next.includes("NO_SHOW") && <ActionForm variant="secondary" action={transitionAction.bind(null, propertySlug, r.id, "NO_SHOW")} submitLabel="Mark no-show" confirm="Mark this booking as a no-show? The room is released and the policy penalty applies." />}
                {next.includes("CANCELLED") && (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold text-[#991b1b]">Cancel reservation</summary>
                    <ActionForm variant="danger" action={transitionAction.bind(null, propertySlug, r.id, "CANCELLED")} submitLabel="Cancel reservation" className="mt-2">
                      <p className="m-0 text-[12px] text-muted">Penalty under the policy if cancelled now: <b>{formatPeso(preview)}</b></p>
                      <Field label="Reason" name="reason" required />
                    </ActionForm>
                  </details>
                )}
              </div>
            </Card>
          )}

          {["CHECKED_IN", "CHECKED_OUT"].includes(r.status) && <Link href={`${base}/reservations/${r.id}/registration-card`} className="text-[13px]">Registration card</Link>}
          <Card title="Guest" actions={<Link href={`${base}/guests/${guest.id}`} className="text-[13px]">Open</Link>}>
            <div className="text-[13px] leading-6">
              <div className="font-semibold">{guest.firstName} {guest.lastName}</div>
              <div>{guest.email ?? <span className="text-muted">No email</span>}</div>
              <div>{guest.mobile ?? <span className="text-muted">No mobile</span>}</div>
              <div className="text-muted">{r.adults} adult{r.adults > 1 ? "s" : ""}{r.children ? `, ${r.children} children` : ""}</div>
            </div>
          </Card>

          {manage && ["INQUIRY", "NOT_CONFIRMED", "CONFIRMED", "CHECKED_IN"].includes(r.status) && (
            <Card title="Dates">
              <ActionForm action={changeDatesAction.bind(null, propertySlug, r.id)} submitLabel="Change dates">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Arrival" name="checkIn" type="date" defaultValue={r.checkIn} readOnly={r.status === "CHECKED_IN"} min={r.status === "CHECKED_IN" ? undefined : prop.businessDate} />
                  <Field label="Departure" name="checkOut" type="date" defaultValue={r.checkOut} />
                </div>
                <p className="m-0 text-[11px] text-muted">The stay is re-priced at today&apos;s rates.</p>
                {can(ctx, "property.manage") && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="overbook" /> Allow overbooking</label>}
                {can(ctx, "rates.manage") && <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" name="ignoreRestrictions" /> Book past rate restrictions</label>}
              </ActionForm>
            </Card>
          )}

          {manage && (
            <Card title="Details">
              <ActionForm action={infoAction.bind(null, propertySlug, r.id)} submitLabel="Save details">
                <Select label="Source" name="source" options={Object.entries(SOURCES).map(([value, label]) => ({ value, label }))} defaultValue={r.source} />
                <Field label="Reference" name="externalRef" defaultValue={r.externalRef ?? ""} />
                <TextArea label="Booking notes" name="notes" defaultValue={r.notes ?? ""} />
              </ActionForm>
            </Card>
          )}
          {r.cancelReason && <Card title="Cancellation"><p className="m-0 text-[13px]">{r.cancelReason}</p><p className="m-0 mt-1 text-[12px] text-muted">{formatDateTime(r.cancelledAt)}</p></Card>}
        </div>
      </div>
    </>
  );
}
