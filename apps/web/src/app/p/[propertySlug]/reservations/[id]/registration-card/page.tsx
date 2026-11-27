import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatDate, formatPeso, nightsBetween } from "@sentire-pms/core";
import { formatDateTime } from "@/components/ui";
import { requireTenant } from "@/server/iam/request";
import { registrationCard } from "@/server/frontdesk";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

export default async function RegistrationCard({ params, searchParams }: { params: Promise<{ propertySlug: string; id: string }>; searchParams: Promise<{ printed?: string }> }) {
  const { propertySlug, id } = await params;
  const { printed } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const d = await registrationCard(getDb(), ctx, id);
  const { reservation: r, guest: g, property: p } = d;
  const n = nightsBetween(r.checkIn, r.checkOut).length;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[180px_1fr] border-b border-line-soft py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="font-semibold">{value || " "}</span>
    </div>
  );
  return (
    <div className="mx-auto max-w-[760px]">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href={`/p/${propertySlug}/reservations/${id}`} className="text-[13px]">Back to the reservation</Link>
        <PrintButton auto={printed === "0"} />
      </div>
      <article className="rounded-card border border-line bg-surface p-8 print:border-0 print:p-0">
        <header className="mb-5 flex items-start justify-between">
          <div>
            <h1 className="m-0 text-xl font-bold">{p.name}</h1>
            <div className="text-[12px] text-muted">{p.registeredName}{p.tin ? `, TIN ${p.tin}` : ""}</div>
            <div className="text-[12px] text-muted">{p.address}</div>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-bold">Guest registration card</div>
            <div className="font-mono text-[13px]">{r.code}</div>
          </div>
        </header>
        {row("Guest name", `${g.lastName}, ${g.firstName}`)}
        {row("Nationality", g.nationality)}
        {row("Address", g.address)}
        {row("Mobile", g.mobile)}
        {row("Email", g.email)}
        {row("Birth date", g.birthDate ? formatDate(g.birthDate) : "")}
        {row("ID presented", [g.idType, g.idNumber].filter(Boolean).join(" "))}
        {row("Company", g.company)}
        {row("Arrival", `${formatDate(r.checkIn)}, from ${p.checkInTime.slice(0, 5)}`)}
        {row("Departure", `${formatDate(r.checkOut)}, by ${p.checkOutTime.slice(0, 5)}`)}
        {row("Nights", n)}
        {row("Rooms", d.rooms.map((x) => `${x.roomNumber ?? "?"} ${x.typeName} (${x.rr.adults + x.rr.children} guests)`).join("; "))}
        {row("Room charges", `${formatPeso(r.totalCentavos)}, VAT included`)}
        {d.discounts.length > 0 && row("Senior citizen or PWD", d.discounts.map((x) => `${x.type === "PWD" ? "PWD" : "Senior citizen"}: ${x.holderName}, ID ${x.idNumber}`).join("; "))}
        <p className="mt-6 text-[12px] leading-relaxed text-ink-2">
          I agree to settle all charges on departure and to follow the house rules. My personal data is used only for this stay and as required by law (Data Privacy Act of 2012).
        </p>
        <div className="mt-10 grid grid-cols-2 gap-10 text-[12px]">
          <div className="border-t border-ink pt-1">Guest signature</div>
          <div className="border-t border-ink pt-1">Front desk, {r.checkedInAt ? formatDateTime(r.checkedInAt) : formatDate(p.businessDate)}</div>
        </div>
      </article>
    </div>
  );
}
