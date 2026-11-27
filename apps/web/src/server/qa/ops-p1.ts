import { z } from "zod";
import { availability } from "../inventory/engine";
import { createBlock, createRoom, createRoomRange, createRoomType, listBlocks, listRooms, listRoomTypes, releaseBlock, setRoomActive, setRoomTypeActive, updateRoomType } from "../inventory/rooms";
import { createTaxFee, listTaxFees, setTaxFeeActive } from "../inventory/taxes";
import { addStaff, changeStaffRole, listStaff, setStaffActive } from "../iam/staff";
import { registerOperations } from "./operations";

const any = z.record(z.string(), z.unknown());
const id = z.object({ id: z.string() });
const idActive = z.object({ id: z.string(), active: z.boolean() });

registerOperations({
  "room_type.list": { description: "List room types (with inactive).", input: z.object({}), run: (db, ctx) => listRoomTypes(db, ctx, { includeInactive: true }) },
  "room_type.create": { description: "Create a room type: code, name, kind (PRIVATE|DORM_BED|VIRTUAL), maxGuests, baseRate (pesos text).", input: any, run: (db, ctx, a) => createRoomType(db, ctx, a) },
  "room_type.update": { description: "Update a room type: id plus the create fields.", input: any, run: (db, ctx, a) => updateRoomType(db, ctx, String((a as { id: string }).id), a) },
  "room_type.set_active": { description: "Turn a room type on or off: id, active.", input: idActive, run: (db, ctx, a) => setRoomTypeActive(db, ctx, (a as z.infer<typeof idActive>).id, (a as z.infer<typeof idActive>).active) },
  "room.list": { description: "List rooms (with inactive).", input: z.object({}), run: (db, ctx) => listRooms(db, ctx, { includeInactive: true }) },
  "room.create": { description: "Create a room: roomTypeId, number, notes.", input: any, run: (db, ctx, a) => createRoom(db, ctx, a) },
  "room.create_range": { description: "Create rooms prefix+from..to: roomTypeId, prefix, from, to.", input: any, run: (db, ctx, a) => createRoomRange(db, ctx, a) },
  "room.set_active": { description: "Turn a room on or off: id, active.", input: idActive, run: (db, ctx, a) => setRoomActive(db, ctx, (a as z.infer<typeof idActive>).id, (a as z.infer<typeof idActive>).active) },
  "block.list": { description: "Current and future blocks.", input: z.object({ from: z.string().optional() }), run: (db, ctx, a) => listBlocks(db, ctx, a as { from?: string }) },
  "block.create": { description: "Block a room: roomId, startDate, endDate (exclusive), type (OUT_OF_SERVICE|OWNER_STAY|COURTESY_HOLD), reason.", input: any, run: (db, ctx, a) => createBlock(db, ctx, a) },
  "block.release": { description: "Release a block: id.", input: id, run: (db, ctx, a) => releaseBlock(db, ctx, (a as { id: string }).id) },
  "inventory.availability": { description: "Availability per room type and night: from, to (exclusive).", input: z.object({ from: z.string(), to: z.string() }), run: (db, ctx, a) => availability(db, ctx, (a as { from: string }).from, (a as { to: string }).to) },
  "tax.list": { description: "Taxes, fees and discounts. value: basis points for PERCENT, centavos for FIXED.", input: z.object({}), run: (db, ctx) => listTaxFees(db, ctx) },
  "tax.create": { description: "Create a tax/fee/discount: code, name, kind, calc, basis, value (text), inclusive, glCode.", input: any, run: (db, ctx, a) => createTaxFee(db, ctx, a) },
  "tax.set_active": { description: "Turn a tax/fee on or off: id, active.", input: idActive, run: (db, ctx, a) => setTaxFeeActive(db, ctx, (a as z.infer<typeof idActive>).id, (a as z.infer<typeof idActive>).active) },
  "staff.list": { description: "Staff at the property.", input: z.object({}), run: (db, ctx) => listStaff(db, ctx) },
  "staff.add": { description: "Add staff: name, email, role, password (temporary).", input: any, run: (db, ctx, a) => addStaff(db, ctx, a) },
  "staff.change_role": { description: "Change role: userId, role.", input: z.object({ userId: z.string(), role: z.string() }), run: (db, ctx, a) => changeStaffRole(db, ctx, (a as { userId: string }).userId, (a as { role: string }).role) },
  "staff.set_active": { description: "Deactivate or reactivate: userId, active.", input: z.object({ userId: z.string(), active: z.boolean() }), run: (db, ctx, a) => setStaffActive(db, ctx, (a as { userId: string }).userId, (a as { active: boolean }).active) },
});
