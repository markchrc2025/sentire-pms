import { redirect } from "next/navigation";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
const TABS = ["Arrivals", "Departures", "In-house", "Stayovers", "Bookings today", "Cancellations", "Overbookings"];


export default async function DashboardPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  if (!can(ctx, "reservations.view")) redirect(`/p/${propertySlug}/housekeeping`);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-[22px] font-bold">Dashboard</h1>
      </div>
      <section className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-[18px]">
        <h2 className="m-0 text-base font-semibold">Activity</h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
          {TABS.map((t) => (
            <div key={t} className="rounded-[10px] border border-line px-3 py-2.5">
              <div className="text-[22px] font-bold text-muted">0</div>
              <div className="text-xs text-muted">{t}</div>
            </div>
          ))}
        </div>
        <div className="rounded-[10px] border border-dashed border-[#d4d4d2] p-6 text-center text-[13px] text-muted">
          No reservations yet. Reservations and the live dashboard arrive in Phase 4; rooms and rates come first.
        </div>
      </section>
    </div>
  );
}
