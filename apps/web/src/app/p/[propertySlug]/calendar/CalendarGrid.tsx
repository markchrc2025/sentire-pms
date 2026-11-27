"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CalBar, CalendarData } from "@/server/calendar";
import { moveBarAction } from "./actions";

const COLORS: Record<string, string> = {
  CONFIRMED: "bg-[#2563eb] text-white",
  CHECKED_IN: "bg-[#15803d] text-white",
  NOT_CONFIRMED: "bg-[#f59e0b] text-[#1f1300]",
  CHECKED_OUT: "bg-[#9ca3af] text-white",
  INQUIRY: "bg-[#e5e7eb] text-ink",
};
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const peso = (c: string | null) => (c === null ? "Closed" : `₱${(Number(c) / 100).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`);

export function CalendarGrid({ data, slug, businessDate, canMove }: { data: CalendarData; slug: string; businessDate: string; canMove: boolean }) {
  const [selected, setSelected] = useState<CalBar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const n = data.dates.length;
  const colW = n > 14 ? 44 : 78;
  const cols = `180px repeat(${n}, ${colW}px)`;

  const drop = (roomId: string, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    start(async () => {
      const r = await moveBarAction(slug, id, roomId);
      setError(r.error ?? null);
      router.refresh();
    });
  };

  const Bar = ({ b }: { b: CalBar }) => (
    <button
      type="button"
      draggable={canMove && b.status !== "CHECKED_OUT"}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", b.reservationRoomId)}
      onClick={() => setSelected(b)}
      title={`${b.guest}, ${b.code}`}
      className={`absolute top-1 z-[1] h-7 truncate px-2 text-left text-[11px] font-semibold ${COLORS[b.status] ?? "bg-ink text-white"} ${b.continuesBefore ? "rounded-l-none" : "rounded-l-md"} ${b.continuesAfter ? "rounded-r-none" : "rounded-r-md"} ${canMove ? "cursor-grab" : ""}`}
      style={{ left: b.start * colW + 2, width: b.span * colW - 4 }}
    >
      {b.guest}
    </button>
  );

  return (
    <div className="relative">
      {error && <div role="alert" className="mb-3 rounded-control border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[13px] text-[#991b1b]">{error}</div>}
      {pending && <div role="status" className="mb-2 text-[12px] text-muted">Moving</div>}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <div className="min-w-max text-[12px]">
          <div className="sticky top-0 z-[2] grid border-b border-line bg-surface" style={{ gridTemplateColumns: cols }}>
            <div className="sticky left-0 bg-surface px-3 py-2 text-[11px] font-semibold uppercase text-muted">Room</div>
            {data.dates.map((d) => {
              const dt = new Date(`${d}T00:00:00Z`);
              const weekend = dt.getUTCDay() === 5 || dt.getUTCDay() === 6;
              return (
                <div key={d} className={`border-l border-line px-1 py-1.5 text-center ${d === businessDate ? "bg-accent-soft font-bold text-accent-hover" : weekend ? "bg-surface-muted" : ""}`}>
                  <div className="text-[10px] uppercase text-muted">{DAYS[dt.getUTCDay()]}</div>
                  <div className="font-semibold">{Number(d.slice(8))}</div>
                </div>
              );
            })}
          </div>
          {data.types.map((t) => (
            <div key={t.id}>
              <div className="grid border-b border-line bg-surface-muted" style={{ gridTemplateColumns: cols }}>
                <div className="sticky left-0 bg-surface-muted px-3 py-1.5 font-semibold">{t.code} {t.name}</div>
                {t.available.map((a, i) => (
                  <div key={i} className="border-l border-line px-1 py-1 text-center leading-tight">
                    <div className={a <= 0 ? "font-bold text-[#991b1b]" : "font-semibold"}>{a}</div>
                    <div className="text-[10px] text-muted">{peso(t.rates[i]!)}</div>
                  </div>
                ))}
              </div>
              {t.unassigned.length > 0 && (
                <div className="grid border-b border-line-soft" style={{ gridTemplateColumns: cols }}>
                  <div className="sticky left-0 bg-surface px-3 py-2 text-[11px] font-semibold text-[#b45309]">Not assigned ({t.unassigned.length})</div>
                  <div className="relative" style={{ gridColumn: `2 / span ${n}`, height: Math.max(36, 32 * t.unassigned.length + 4) }}>
                    {t.unassigned.map((b, i) => (
                      <div key={b.reservationRoomId + b.start} className="absolute left-0 right-0" style={{ top: i * 32 }}>
                        <Bar b={b} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {t.rooms.map((r) => (
                <div
                  key={r.id}
                  className={`grid border-b border-line-soft ${over === r.id ? "bg-accent-soft" : ""}`}
                  style={{ gridTemplateColumns: cols }}
                  onDragOver={(e) => {
                    if (!canMove) return;
                    e.preventDefault();
                    setOver(r.id);
                  }}
                  onDragLeave={() => setOver(null)}
                  onDrop={(e) => drop(r.id, e)}
                >
                  <div className="sticky left-0 z-[1] flex items-center gap-2 bg-surface px-3 py-2">
                    <span className="font-semibold">{r.number}</span>
                    <span className={`h-2 w-2 rounded-full ${r.condition === "DIRTY" ? "bg-[#d97706]" : r.condition === "INSPECTED" ? "bg-[#2563eb]" : "bg-[#16a34a]"}`} title={r.condition} aria-label={`Condition ${r.condition.toLowerCase()}`} />
                  </div>
                  <div className="relative h-9" style={{ gridColumn: `2 / span ${n}` }}>
                    {data.dates.map((d, i) => <div key={d} className="absolute bottom-0 top-0 border-l border-line-soft" style={{ left: i * colW }} />)}
                    {data.blocks.filter((b) => b.roomId === r.id).map((b, i) => (
                      <div key={i} title={b.reason} className="absolute top-1 h-7 rounded-md border border-[#fecaca] bg-[repeating-linear-gradient(45deg,#fee2e2,#fee2e2_5px,#fff_5px,#fff_10px)] px-2 text-[11px] font-semibold leading-7 text-[#991b1b]" style={{ left: b.start * colW + 2, width: b.span * colW - 4 }}>
                        {b.type === "OUT_OF_SERVICE" ? "Out of service" : b.type === "OWNER_STAY" ? "Owner stay" : "Courtesy hold"}
                      </div>
                    ))}
                    {data.bars.filter((b) => b.roomId === r.id).map((b) => <Bar key={b.reservationRoomId + b.start} b={b} />)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {selected && (
        <aside aria-label="Reservation" className="fixed bottom-0 right-0 top-0 z-30 w-[340px] border-l border-line bg-surface p-5 shadow-[0_0_32px_rgba(0,0,0,0.12)]">
          <button type="button" onClick={() => setSelected(null)} className="float-right text-[13px] text-muted">Close</button>
          <h2 className="m-0 text-lg font-bold">{selected.guest}</h2>
          <p className="m-0 font-mono text-[13px]">{selected.code}</p>
          <p className="text-[13px]">{selected.checkIn} to {selected.checkOut}</p>
          <p className="text-[13px]">Status: {selected.status.replace("_", " ").toLowerCase()}</p>
          {canMove && <p className="text-[12px] text-muted">Drag the bar onto another room of the same type to move it.</p>}
          <Link href={`/p/${slug}/reservations/${selected.reservationId}`} className="inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-[13px] font-semibold text-white no-underline hover:text-white">Open reservation</Link>
        </aside>
      )}
    </div>
  );
}
