import Link from "next/link";
import { getDb } from "@sentire-pms/db";
import { Badge, Card, Field, PageHeader, Select, Table } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { listRooms, listRoomTypes } from "@/server/inventory/rooms";
import { addRoomRangeAction, roomActiveAction, saveRoomAction } from "../actions";

export default async function RoomsPage({ params, searchParams }: { params: Promise<{ propertySlug: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { propertySlug } = await params;
  const { edit } = await searchParams;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const [rooms, types] = await Promise.all([listRooms(db, ctx, { includeInactive: true }), listRoomTypes(db, ctx)]);
  const manage = can(ctx, "property.manage");
  const editing = edit ? rooms.find((r) => r.room.id === edit)?.room : undefined;
  const typeOptions = types.map((t) => ({ value: t.id, label: `${t.code} ${t.name}` }));
  const base = `/p/${propertySlug}/settings/rooms`;
  return (
    <>
      <PageHeader title="Rooms" subtitle={`${rooms.filter((r) => r.room.active).length} active rooms and beds.`} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <Table head={["Room", "Type", "Condition", "Notes", "Status", ""]} empty={rooms.length ? undefined : "No rooms yet. Add a room type first, then its rooms."}>
            {rooms.map(({ room, typeCode, typeName }) => (
              <tr key={room.id}>
                <td className="font-semibold">{room.number}</td>
                <td>{typeCode} {typeName}</td>
                <td><Badge status={room.condition} /></td>
                <td className="text-muted">{room.notes}</td>
                <td>{room.active ? <Badge status="CLEAN">Active</Badge> : <Badge status="CHECKED_OUT">Off</Badge>}</td>
                <td className="whitespace-nowrap text-right">
                  {manage && (
                    <span className="inline-flex items-center gap-2">
                      <Link href={`${base}?edit=${room.id}`} className="text-[13px]">Edit</Link>
                      <ActionForm inline variant="secondary" action={roomActiveAction.bind(null, propertySlug, room.id, !room.active)} submitLabel={room.active ? "Turn off" : "Turn on"} />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        {manage && types.length > 0 && (
          <div className="flex flex-col gap-5">
            <Card title={editing ? `Edit room ${editing.number}` : "Add a room"} actions={editing ? <Link href={base} className="text-[13px]">Cancel</Link> : undefined}>
              <ActionForm key={editing?.id ?? "new"} action={saveRoomAction.bind(null, propertySlug, editing?.id ?? null)} submitLabel={editing ? "Save room" : "Add room"} resetOnOk={!editing}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Room or bed number" name="number" defaultValue={editing?.number} required />
                  <Field label="Sort order" name="sortOrder" type="number" min={0} defaultValue={editing?.sortOrder ?? 0} />
                  <Select label="Room type" name="roomTypeId" options={typeOptions} defaultValue={editing?.roomTypeId} className="col-span-2" />
                  <Field label="Notes" name="notes" defaultValue={editing?.notes ?? ""} className="col-span-2" />
                </div>
              </ActionForm>
            </Card>
            {!editing && (
              <Card title="Add a range of rooms">
                <ActionForm action={addRoomRangeAction.bind(null, propertySlug)} submitLabel="Add rooms" resetOnOk>
                  <div className="grid grid-cols-3 gap-3">
                    <Select label="Room type" name="roomTypeId" options={typeOptions} className="col-span-3" />
                    <Field label="Prefix" name="prefix" placeholder="B-" />
                    <Field label="From" name="from" type="number" min={0} required />
                    <Field label="To" name="to" type="number" min={0} required />
                  </div>
                </ActionForm>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
