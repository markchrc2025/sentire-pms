import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { formatPeso } from "@sentire-pms/core";
import { Badge, Card, Field, PageHeader, Select, Table, TextArea } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { listRoomTypes } from "@/server/inventory/rooms";
import { roomTypeActiveAction, saveRoomTypeAction } from "../actions";

const KINDS = [
  { value: "PRIVATE", label: "Private room" },
  { value: "DORM_BED", label: "Dorm bed" },
  { value: "VIRTUAL", label: "Virtual (sold as a package of rooms)" },
];
const kindLabel = (k: string) => KINDS.find((x) => x.value === k)?.label ?? k;
const pesoInput = (c: bigint) => (Number(c) / 100).toFixed(2);

export default async function RoomTypesPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { propertySlug } = await params;
  const { edit } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const types = await listRoomTypes(getDb(), ctx, { includeInactive: true });
  const manage = can(ctx, "property.manage");
  const editing = edit ? types.find((t) => t.id === edit) : undefined;
  const base = `/p/${propertySlug}/settings/room-types`;
  return (
    <>
      <PageHeader title="Room types" subtitle="What you sell. Each room or bed belongs to one type." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <Table head={["Code", "Name", "Kind", "Max guests", "Base rate", "Rooms", "Status", ""]} empty={types.length ? undefined : "No room types yet. Add your first one."}>
            {types.map((t) => (
              <tr key={t.id}>
                <td className="font-semibold">{t.code}</td>
                <td>{t.name}</td>
                <td>{kindLabel(t.kind)}</td>
                <td>{t.maxGuests}</td>
                <td>{formatPeso(t.baseRateCentavos)}</td>
                <td>{t.roomCount}</td>
                <td>{t.active ? <Badge status="CLEAN">Active</Badge> : <Badge status="CHECKED_OUT">Off</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  {manage && (
                    <span className="inline-flex items-center gap-2">
                      <Link href={`${base}?edit=${t.id}`} className="text-[13px]">Edit</Link>
                      <ActionForm inline variant="secondary" action={roomTypeActiveAction.bind(null, propertySlug, t.id, !t.active)} submitLabel={t.active ? "Turn off" : "Turn on"} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        {manage && (
          <Card title={editing ? `Edit ${editing.name}` : "Add a room type"} actions={editing ? <Link href={base} className="text-[13px]">Cancel</Link> : undefined}>
            <ActionForm key={editing?.id ?? "new"} action={saveRoomTypeAction.bind(null, propertySlug, editing?.id ?? null)} submitLabel={editing ? "Save room type" : "Add room type"} resetOnOk={!editing}>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code" name="code" defaultValue={editing?.code} placeholder="DLX" required />
                <Field label="Base rate (₱)" name="baseRate" inputMode="decimal" defaultValue={editing ? pesoInput(editing.baseRateCentavos) : ""} placeholder="3200.00" required />
                <Field label="Name" name="name" defaultValue={editing?.name} placeholder="Deluxe Queen" required className="col-span-2" />
                <Select label="Kind" name="kind" options={KINDS} defaultValue={editing?.kind ?? "PRIVATE"} />
                <Field label="Max guests" name="maxGuests" type="number" min={1} max={50} defaultValue={editing?.maxGuests ?? 2} />
                <Field label="Sort order" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
                <TextArea label="Description" name="description" defaultValue={editing?.description ?? ""} className="col-span-2" />
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
