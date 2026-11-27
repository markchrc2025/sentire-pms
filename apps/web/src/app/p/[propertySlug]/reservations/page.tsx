import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatPeso, STATUS_LABEL, type ResStatus } from "@sentire-pms/core";
import { Badge, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { listReservations, SOURCES } from "@/server/reservations";
import { listRoomTypes } from "@/server/inventory/rooms";

export const dynamic = "force-dynamic";

const STATUSES = Object.keys(STATUS_LABEL) as ResStatus[];

export default async function ReservationsPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { propertySlug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) || undefined;
  const status = ([] as string[]).concat(sp.status ?? []).filter((s): s is ResStatus => STATUSES.includes(s as ResStatus));
  const page = Number(one("page") ?? 1) || 1;
  const filters = { q: one("q"), status, from: one("from"), to: one("to"), source: one("source"), roomTypeId: one("roomTypeId"), page };
  const [{ rows, more }, types] = await Promise.all([listReservations(db, ctx, filters), listRoomTypes(db, ctx)]);
  const base = `/p/${propertySlug}/reservations`;
  const qs = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, status: undefined, ...o })) if (v !== undefined && v !== "") u.set(k, String(v));
    for (const s of status) u.append("status", s);
    return `${base}?${u}`;
  };
  return (
    <>
      <PageHeader title="Reservations" subtitle="Search by code, guest name, email or mobile." actions={can(ctx, "reservations.manage") ? <LinkButton variant="primary" href={`${base}/new`}>New reservation</LinkButton> : undefined} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 text-[13px]" action={base}>
          <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold">Search</span><input name="q" defaultValue={filters.q} className="h-9 w-[220px] rounded-control border border-line px-2.5" /></label>
          <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold">Staying from</span><input type="date" name="from" defaultValue={filters.from} className="h-9 rounded-control border border-line px-2" /></label>
          <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold">to</span><input type="date" name="to" defaultValue={filters.to} className="h-9 rounded-control border border-line px-2" /></label>
          <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold">Source</span>
            <select name="source" defaultValue={filters.source ?? ""} className="h-9 rounded-control border border-line px-2"><option value="">All</option>{Object.entries(SOURCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold">Room type</span>
            <select name="roomTypeId" defaultValue={filters.roomTypeId ?? ""} className="h-9 rounded-control border border-line px-2"><option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}</select>
          </label>
          <fieldset className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
            <legend className="sr-only">Status</legend>
            {STATUSES.map((s) => <label key={s} className="flex items-center gap-1"><input type="checkbox" name="status" value={s} defaultChecked={status.includes(s)} /> {STATUS_LABEL[s]}</label>)}
          </fieldset>
          <button type="submit" className="h-9 rounded-control border border-line px-3.5 font-semibold hover:bg-surface-muted">Filter</button>
          <Link href={base}>Clear</Link>
        </form>
      </Card>
      <Card>
        <Table head={["Code", "Guest", "Arrival", "Departure", "Rooms", "Source", "Status", "Total"]} empty={rows.length ? undefined : "No reservations match."}>
          {rows.map(({ r, guestName, rooms }) => (
            <tr key={r.id}>
              <td><Link href={`${base}/${r.id}`} className="font-mono font-semibold">{r.code}</Link></td>
              <td>{guestName}</td>
              <td className="whitespace-nowrap">{formatDate(r.checkIn)}</td>
              <td className="whitespace-nowrap">{formatDate(r.checkOut)}</td>
              <td>{rooms}</td>
              <td>{SOURCES[r.source]}</td>
              <td><Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge></td>
              <td className="whitespace-nowrap">{formatPeso(r.totalCentavos)}</td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex justify-between text-[13px]">
          {page > 1 ? <Link href={qs({ page: page - 1 })}>Previous</Link> : <span />}
          {more && <Link href={qs({ page: page + 1 })}>Next</Link>}
        </div>
      </Card>
    </>
  );
}
