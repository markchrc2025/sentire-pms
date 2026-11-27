import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatDayShort, formatPeso, STATUS_LABEL } from "@sentire-pms/core";
import { Badge, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { dashboard, TABS, type Tab } from "@/server/dashboard";

export const dynamic = "force-dynamic";

const TAB_LABEL: Record<Tab, string> = { arrivals: "Arrivals", departures: "Departures", inhouse: "In-house", stayovers: "Stayovers", new: "Bookings today", cancellations: "Cancellations", overbookings: "Overbookings" };

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { propertySlug } = await params;
  const { tab: t } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "reservations.view")) redirect(`/p/${propertySlug}/housekeeping`);
  const d = await dashboard(getDb(), ctx);
  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : "arrivals";
  const base = `/p/${propertySlug}`;
  const count = (k: Tab) => (k === "overbookings" ? d.overbookings.length : d.lists[k].length);
  const max = Math.max(...d.forecast.map((f) => f.occupancy), 1);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Dashboard" subtitle={`Business date ${formatDate(d.businessDate)}`} actions={can(ctx, "reservations.manage") ? <LinkButton variant="primary" href={`${base}/reservations/new`}>New reservation</LinkButton> : undefined} />
      <Card title="Activity">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2" role="tablist" aria-label="Activity">
          {TABS.map((k) => (
            <Link key={k} href={`${base}?tab=${k}`} role="tab" aria-selected={k === tab} className={`rounded-[10px] border px-3 py-2.5 no-underline ${k === tab ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-muted"}`}>
              <div className={`text-[22px] font-bold ${k === "overbookings" && count(k) ? "text-[#991b1b]" : "text-ink"}`}>{count(k)}</div>
              <div className="text-xs text-muted">{TAB_LABEL[k]}</div>
            </Link>
          ))}
        </div>
        <div className="mt-4">
          {tab === "overbookings" ? (
            <Table head={["Night", "Room type", "Rooms over"]} empty={d.overbookings.length ? undefined : "No overbookings."}>
              {d.overbookings.map((o, i) => <tr key={i}><td>{formatDate(o.date)}</td><td>{o.type}</td><td className="font-semibold text-[#991b1b]">{o.units}</td></tr>)}
            </Table>
          ) : (
            <Table head={["Code", "Guest", "Arrival", "Departure", "Rooms", "Status", "Total"]} empty={d.lists[tab].length ? undefined : `No ${TAB_LABEL[tab].toLowerCase()} for this business date.`}>
              {d.lists[tab].map(({ r, guest, rooms }) => (
                <tr key={r.id}>
                  <td><Link href={`${base}/reservations/${r.id}`} className="font-mono font-semibold">{r.code}</Link></td>
                  <td>{guest}</td>
                  <td>{formatDate(r.checkIn)}</td>
                  <td>{formatDate(r.checkOut)}</td>
                  <td>{rooms}</td>
                  <td><Badge status={r.status}>{STATUS_LABEL[r.status]}</Badge></td>
                  <td>{formatPeso(r.totalCentavos)}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card title="Occupancy tonight">
          <div className="text-[40px] font-bold leading-none">{d.today.occupancy}%</div>
          <p className="mb-0 mt-2 text-[13px] text-muted">{d.today.sold} of {d.today.sellable} sellable rooms and beds</p>
        </Card>
        <Card title="Next 14 days">
          <div className="flex items-end gap-1.5 overflow-x-auto pb-1" role="img" aria-label="Occupancy forecast for the next 14 days">
            {d.forecast.map((f) => (
              <div key={f.date} className="flex min-w-[44px] flex-1 flex-col items-center gap-1 text-[11px]">
                <span className="font-semibold">{f.occupancy}%</span>
                <div className="flex h-[110px] w-full items-end rounded bg-surface-muted">
                  <div className="w-full rounded bg-accent" style={{ height: `${(f.occupancy / max) * 100}%`, minHeight: f.occupancy ? 3 : 0 }} />
                </div>
                <span className="text-muted">{formatDayShort(f.date)}</span>
                <span title="Arrivals and departures" className="text-muted">{f.arrivals} in / {f.departures} out</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
