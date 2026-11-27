import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatPeso } from "@sentire-pms/core";
import { Card, Field, Notice, PageHeader, Select } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { getReservation } from "@/server/reservations";
import { ID_TYPES } from "@/server/frontdesk";
import { getProperty } from "@/server/property";
import { checkInAction, idImageAction } from "../frontdesk-actions";
import { IdCapture } from "./IdCapture";

export const dynamic = "force-dynamic";

export default async function CheckInPage({ params }: { params: Promise<{ propertySlug: string; id: string }> }) {
  const { propertySlug, id } = await params;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const [{ reservation: r, guest: g, rooms }, p] = await Promise.all([getReservation(db, ctx, id), getProperty(db, ctx)]);
  const base = `/p/${propertySlug}/reservations/${id}`;
  if (!can(ctx, "reservations.manage")) return <Notice kind="warn">Your role cannot check guests in.</Notice>;
  const problems: string[] = [];
  if (r.status !== "CONFIRMED") problems.push(r.status === "NOT_CONFIRMED" ? "The booking is not confirmed yet. Confirm it first (deposits are taken from Phase 6)." : `This reservation is ${r.status.replace("_", " ").toLowerCase()}.`);
  if (r.checkIn !== p.businessDate) problems.push(`Check-in is on the arrival date (${formatDate(r.checkIn)}); the business date is ${formatDate(p.businessDate)}.`);
  const live = rooms.filter((x) => x.rr.active);
  if (live.some((x) => !x.rr.roomId)) problems.push("Assign a room to every booked room first.");
  const dirty = live.filter((x) => x.roomCondition === "DIRTY");
  return (
    <>
      <PageHeader title={`Check in ${g.firstName} ${g.lastName}`} subtitle={`${r.code}, ${formatDate(r.checkIn)} to ${formatDate(r.checkOut)}`} actions={<Link href={base} className="text-[13px]">Back to the reservation</Link>} />
      {problems.length > 0 && <div className="mb-4 flex flex-col gap-2">{problems.map((x) => <Notice key={x} kind="warn">{x} <Link href={base}>Open the reservation</Link></Notice>)}</div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Guest details">
          <ActionForm action={checkInAction.bind(null, propertySlug, id)} submitLabel="Check in and print the registration card">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First name" name="firstName" defaultValue={g.firstName} required />
              <Field label="Last name" name="lastName" defaultValue={g.lastName} required />
              <Field label="Mobile" name="mobile" defaultValue={g.mobile ?? ""} />
              <Field label="Email" name="email" type="email" defaultValue={g.email ?? ""} />
              <Field label="Nationality" name="nationality" defaultValue={g.nationality ?? "PH"} maxLength={2} />
              <Field label="Birth date" name="birthDate" type="date" defaultValue={g.birthDate ?? ""} />
              <Field label="Address" name="address" defaultValue={g.address ?? ""} className="sm:col-span-2" />
              <Field label="Company" name="company" defaultValue={g.company ?? ""} />
              <span />
              <Select label="ID type" name="idType" options={[{ value: "", label: "Choose" }, ...ID_TYPES.map((t) => ({ value: t, label: t }))]} defaultValue={g.idType ?? ""} />
              <Field label="ID number" name="idNumber" defaultValue={g.idNumber ?? ""} />
            </div>
            <fieldset className="m-0 mt-2 rounded-control border border-line p-3">
              <legend className="px-1 text-[12px] font-semibold">Senior citizen or PWD discount (20%, VAT-exempt share)</legend>
              <p className="m-0 mb-2 text-[12px] text-muted">Record the ID of each guest who claims it. The discount is applied on the folio and shown on the invoice (Phase 6).</p>
              {live.map((x) => (
                <div key={x.rr.id} className="mb-2 grid gap-2 sm:grid-cols-[120px_160px_1fr_1fr]">
                  <input type="hidden" name="d-room" value={x.rr.id} />
                  <span className="self-center text-[13px] font-semibold">{x.roomNumber ?? x.typeCode}</span>
                  <Select label="Claim" name="d-type" options={[{ value: "", label: "None" }, { value: "SENIOR_CITIZEN", label: "Senior citizen" }, { value: "PWD", label: "PWD" }]} id={`d-type-${x.rr.id}`} />
                  <Field label="Name on the ID" name="d-name" id={`d-name-${x.rr.id}`} />
                  <Field label="SC or PWD ID number" name="d-id" id={`d-id-${x.rr.id}`} />
                </div>
              ))}
            </fieldset>
            {dirty.length > 0 && (
              <div className="flex flex-col gap-2">
                <Notice kind="warn">Room {dirty.map((x) => x.roomNumber).join(", ")} is not clean yet.</Notice>
                {can(ctx, "property.manage") && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="allowDirty" /> Check in anyway (Admin)</label>}
              </div>
            )}
          </ActionForm>
        </Card>
        <div className="flex flex-col gap-5">
          <Card title="Identity document">
            <IdCapture action={idImageAction.bind(null, propertySlug, g.id)} existing={g.idFileId ? `/p/${propertySlug}/files/${g.idFileId}` : null} />
          </Card>
          <Card title="Rooms">
            <ul className="m-0 list-none p-0 text-[13px]">
              {live.map((x) => (
                <li key={x.rr.id} className="flex justify-between border-b border-line-soft py-1.5 last:border-0">
                  <span><b>{x.roomNumber ?? "Not assigned"}</b> {x.typeName}</span>
                  <span className={x.roomCondition === "DIRTY" ? "text-[#b45309]" : "text-[#15803d]"}>{x.roomCondition ? x.roomCondition.charAt(0) + x.roomCondition.slice(1).toLowerCase() : ""}</span>
                </li>
              ))}
            </ul>
            <p className="mb-0 mt-3 text-[12px] text-muted">Room charges {formatPeso(r.totalCentavos)}. Deposit to confirm {formatPeso(r.guaranteeCentavos)}.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
