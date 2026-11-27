import { getDb } from "@sentire-pms/db";
import { addDays, formatDate } from "@sentire-pms/core";
import { Card, Field, PageHeader, Select, Table, TextArea } from "@/components/ui";
import { ActionForm } from "@/components/ui/ActionForm";
import { requireTenant } from "@/server/iam/request";
import { can } from "@/server/iam/tenant";
import { BLOCK_TYPES, listBlocks, listRooms } from "@/server/inventory/rooms";
import { getProperty } from "@/server/property";
import { addBlockAction, releaseBlockAction } from "../actions";

export default async function BlocksPage({ params }: { params: Promise<{ propertySlug: string }> }) {
  const { propertySlug } = await params;
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const p = await getProperty(db, ctx);
  const [blocks, rooms] = await Promise.all([listBlocks(db, ctx, { from: p.businessDate }), listRooms(db, ctx)]);
  const manage = can(ctx, "property.manage");
  return (
    <>
      <PageHeader title="Room blocks" subtitle="Rooms taken out of sale: out of service, owner stays and courtesy holds." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <Table head={["Room", "Type", "From", "Until (sellable again)", "Block", "Reason", ""]} empty={blocks.length ? undefined : "No current or upcoming blocks."}>
            {blocks.map(({ block, roomNumber, typeName }) => (
              <tr key={block.id}>
                <td className="font-semibold">{roomNumber}</td>
                <td>{typeName}</td>
                <td>{formatDate(block.startDate)}</td>
                <td>{formatDate(block.endDate)}</td>
                <td>{BLOCK_TYPES[block.type]}</td>
                <td className="text-muted">{block.reason}</td>
                <td className="text-right">{manage && <ActionForm inline variant="secondary" action={releaseBlockAction.bind(null, propertySlug, block.id)} submitLabel="Release" confirm="Release this block? The room goes back on sale." />}</td>
              </tr>
            ))}
          </Table>
        </Card>
        {manage && (
          <Card title="Block a room">
            <ActionForm action={addBlockAction.bind(null, propertySlug)} submitLabel="Block room" resetOnOk>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Room" name="roomId" options={rooms.map((r) => ({ value: r.room.id, label: `${r.room.number} (${r.typeCode})` }))} className="col-span-2" />
                <Field label="From" name="startDate" type="date" defaultValue={p.businessDate} required />
                <Field label="Until" name="endDate" type="date" defaultValue={addDays(p.businessDate, 1)} required hint="First night it can be sold again" />
                <Select label="Block type" name="type" options={Object.entries(BLOCK_TYPES).map(([value, label]) => ({ value, label }))} className="col-span-2" />
                <TextArea label="Reason" name="reason" required className="col-span-2" />
              </div>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
