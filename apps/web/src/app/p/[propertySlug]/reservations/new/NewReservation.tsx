"use client";
import { useState, useTransition } from "react";
import { Field, Notice, Select, TextArea } from "@/components/ui";
import { createReservationAction, duplicatesAction, findGuestsAction, searchAvailabilityAction, type AvailabilityOption } from "../actions";

interface CartLine {
  key: number;
  roomTypeId: string;
  ratePlanId: string;
  label: string;
  total: string;
  adults: number;
  children: number;
}
type GuestHit = { id: string; name: string; email: string | null; mobile: string | null };

export function NewReservation({ slug, businessDate, tomorrow, sources, canOverbook, canIgnoreRestrictions }: { slug: string; businessDate: string; tomorrow: string; sources: { value: string; label: string }[]; canOverbook: boolean; canIgnoreRestrictions: boolean }) {
  const [dates, setDates] = useState({ checkIn: businessDate, checkOut: tomorrow, adults: 2, children: 0 });
  const [options, setOptions] = useState<AvailabilityOption[] | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [guest, setGuest] = useState<GuestHit | null>(null);
  const [newGuest, setNewGuest] = useState({ firstName: "", lastName: "", email: "", mobile: "", nationality: "PH" });
  const [hits, setHits] = useState<GuestHit[]>([]);
  const [dupes, setDupes] = useState<GuestHit[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Lookups (guest search, duplicate check) run in their own transition so they never block saving.
  const [, lookup] = useTransition();
  const [seq, setSeq] = useState(1);

  const search = () =>
    start(async () => {
      setError(null);
      const r = await searchAvailabilityAction(slug, dates);
      if (r.error) setError(r.error);
      setOptions(r.options ?? null);
      setCart([]);
    });

  const add = (o: AvailabilityOption, p: AvailabilityOption["plans"][number]) => {
    setCart((c) => [...c, { key: seq, roomTypeId: o.roomTypeId, ratePlanId: p.ratePlanId, label: `${o.code} ${o.name}, ${p.code}`, total: p.total, adults: Math.min(dates.adults, o.maxGuests), children: dates.children }]);
    setSeq((s) => s + 1);
  };

  const findGuests = (text: string) => {
    setQ(text);
    if (text.trim().length < 2) return setHits([]);
    lookup(async () => setHits(await findGuestsAction(slug, text)));
  };

  const checkDupes = () => lookup(async () => setDupes(await duplicatesAction(slug, newGuest)));

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    start(async () => {
      setError(null);
      const r = await createReservationAction(slug, {
        source: String(form.get("source")) as never,
        status: String(form.get("status")) as never,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        guestId: guest?.id ?? null,
        guest: guest ? null : newGuest,
        rooms: cart.map((l) => ({ roomTypeId: l.roomTypeId, ratePlanId: l.ratePlanId, adults: l.adults, children: l.children })),
        notes: String(form.get("notes") ?? "") || null,
        externalRef: String(form.get("externalRef") ?? "") || null,
        overbook: form.get("overbook") === "on",
        ignoreRestrictions: form.get("ignoreRestrictions") === "on",
      });
      if (r?.error) setError(r.error);
    });
  };

  const inCart = (roomTypeId: string) => cart.filter((c) => c.roomTypeId === roomTypeId).length;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="m-0 mb-3 text-[15px] font-semibold">1. Dates and guests</h2>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Arrival" name="checkIn" type="date" min={businessDate} value={dates.checkIn} onChange={(e) => setDates({ ...dates, checkIn: e.target.value })} />
          <Field label="Departure" name="checkOut" type="date" min={dates.checkIn} value={dates.checkOut} onChange={(e) => setDates({ ...dates, checkOut: e.target.value })} />
          <Field label="Adults" name="adults" type="number" min={1} max={50} value={dates.adults} onChange={(e) => setDates({ ...dates, adults: Number(e.target.value) })} className="w-24" />
          <Field label="Children" name="children" type="number" min={0} max={50} value={dates.children} onChange={(e) => setDates({ ...dates, children: Number(e.target.value) })} className="w-24" />
          <button type="button" onClick={search} disabled={pending} className="h-9 rounded-control bg-accent px-4 text-[13px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            {pending && !options ? "Searching" : "Show availability"}
          </button>
        </div>
      </section>

      {error && <Notice kind="error">{error}</Notice>}

      {options && (
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="m-0 mb-3 text-[15px] font-semibold">2. Choose rooms</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-muted">
                  <th className="border-b border-line px-2 py-2">Room type</th>
                  <th className="border-b border-line px-2 py-2">Left</th>
                  <th className="border-b border-line px-2 py-2">Rate plan</th>
                  <th className="border-b border-line px-2 py-2">Per night</th>
                  <th className="border-b border-line px-2 py-2">Stay total</th>
                  <th className="border-b border-line px-2 py-2">Deposit</th>
                  <th className="border-b border-line px-2 py-2"><span className="sr-only">Add</span></th>
                </tr>
              </thead>
              <tbody>
                {options.flatMap((o) =>
                  o.plans.map((p, i) => {
                    const left = o.available - inCart(o.roomTypeId);
                    return (
                      <tr key={`${o.roomTypeId}-${p.ratePlanId}`} className="[&>td]:border-b [&>td]:border-line-soft [&>td]:px-2 [&>td]:py-2">
                        <td className="font-semibold">{i === 0 ? `${o.code} ${o.name}` : ""}<div className="text-[11px] font-normal text-muted">{i === 0 ? `Up to ${o.maxGuests} guests` : ""}</div></td>
                        <td className={left <= 0 ? "font-semibold text-[#991b1b]" : ""}>{i === 0 ? left : ""}</td>
                        <td>{p.code} <span className="text-muted">{p.name}</span><div className="text-[11px] text-muted">{p.policyName}</div>{p.problems.length > 0 && <div className="text-[11px] text-[#b45309]">{p.problems.join(" ")}</div>}</td>
                        <td>{p.perNight}</td>
                        <td className="font-semibold">{p.total}</td>
                        <td>{p.guarantee}</td>
                        <td className="text-right">
                          <button type="button" aria-label={`Add ${o.code} ${p.code}`} onClick={() => add(o, p)} disabled={(left <= 0 && !canOverbook) || (p.problems.length > 0 && !canIgnoreRestrictions)} className="h-8 rounded-control border border-line px-3 text-[12px] font-semibold hover:bg-surface-muted disabled:opacity-40">
                            Add
                          </button>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          {cart.length > 0 && (
            <div className="mt-4 rounded-control border border-line p-3">
              <div className="mb-2 text-[12px] font-semibold uppercase text-muted">Rooms in this reservation</div>
              {cart.map((l) => (
                <div key={l.key} className="flex flex-wrap items-center gap-3 border-b border-line-soft py-1.5 text-[13px] last:border-0">
                  <span className="min-w-[220px] font-semibold">{l.label}</span>
                  <label className="flex items-center gap-1">Adults <input aria-label={`Adults in ${l.label}`} type="number" min={1} max={50} value={l.adults} onChange={(e) => setCart(cart.map((x) => (x.key === l.key ? { ...x, adults: Number(e.target.value) } : x)))} className="h-8 w-16 rounded-control border border-line px-2" /></label>
                  <label className="flex items-center gap-1">Children <input aria-label={`Children in ${l.label}`} type="number" min={0} max={50} value={l.children} onChange={(e) => setCart(cart.map((x) => (x.key === l.key ? { ...x, children: Number(e.target.value) } : x)))} className="h-8 w-16 rounded-control border border-line px-2" /></label>
                  <span>{l.total}</span>
                  <button type="button" onClick={() => setCart(cart.filter((x) => x.key !== l.key))} className="ml-auto text-[12px] text-[#991b1b]">Remove</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {cart.length > 0 && (
        <form onSubmit={submit} className="rounded-card border border-line bg-surface p-5">
          <h2 className="m-0 mb-3 text-[15px] font-semibold">3. Guest and details</h2>
          {guest ? (
            <div className="mb-3 flex items-center gap-3 text-[13px]">
              <span>Main guest: <b>{guest.name}</b> {guest.email} {guest.mobile}</span>
              <button type="button" className="text-accent" onClick={() => setGuest(null)}>Change</button>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <Field label="Find an existing guest" name="guestSearch" value={q} onChange={(e) => findGuests(e.target.value)} placeholder="Name, email or mobile" />
                <div className="mt-1 flex flex-col">
                  {hits.map((h) => (
                    <button key={h.id} type="button" onClick={() => setGuest(h)} className="rounded-control px-2 py-1.5 text-left text-[13px] hover:bg-surface-muted">
                      <b>{h.name}</b> <span className="text-muted">{h.email} {h.mobile}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name" name="g-first" value={newGuest.firstName} onChange={(e) => setNewGuest({ ...newGuest, firstName: e.target.value })} required />
                <Field label="Last name" name="g-last" value={newGuest.lastName} onChange={(e) => setNewGuest({ ...newGuest, lastName: e.target.value })} onBlur={checkDupes} required />
                <Field label="Email" name="g-email" type="email" value={newGuest.email} onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })} onBlur={checkDupes} />
                <Field label="Mobile" name="g-mobile" value={newGuest.mobile} onChange={(e) => setNewGuest({ ...newGuest, mobile: e.target.value })} onBlur={checkDupes} placeholder="0917 123 4567" />
                <Field label="Nationality" name="g-nat" value={newGuest.nationality} onChange={(e) => setNewGuest({ ...newGuest, nationality: e.target.value })} maxLength={2} />
                {dupes.length > 0 && (
                  <div className="col-span-2 rounded-control border border-[#fde68a] bg-[#fffbeb] p-2 text-[12px]">
                    Possibly an existing guest:
                    {dupes.map((d) => (
                      <button key={d.id} type="button" onClick={() => setGuest(d)} className="ml-2 font-semibold text-accent underline">{d.name}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Select label="Source" name="source" options={sources} defaultValue="WALK_IN" />
            <Select label="Status" name="status" options={[{ value: "CONFIRMED", label: "Confirmed" }, { value: "NOT_CONFIRMED", label: "Not confirmed (waiting for deposit)" }, { value: "INQUIRY", label: "Inquiry (holds no room)" }]} defaultValue="CONFIRMED" />
            <Field label="Reference (OTA or company)" name="externalRef" />
            <TextArea label="Notes" name="notes" className="sm:col-span-3" />
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[13px]">
            {canOverbook && <label className="flex items-center gap-2"><input type="checkbox" name="overbook" /> Allow overbooking</label>}
            {canIgnoreRestrictions && <label className="flex items-center gap-2"><input type="checkbox" name="ignoreRestrictions" /> Book past rate restrictions</label>}
          </div>
          <button type="submit" disabled={pending} className="mt-4 h-10 rounded-control bg-accent px-5 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-50">
            {pending ? "Saving" : `Create reservation (${cart.length} room${cart.length > 1 ? "s" : ""})`}
          </button>
        </form>
      )}
    </div>
  );
}
