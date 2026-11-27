import { z } from "zod";
import { assignHousekeeper, checkIn, checkOut, discountsFor, folioBalance, housekeepingBoard, registrationCard, setRoomCondition } from "../frontdesk";
import { registerOperations } from "./operations";

registerOperations({
  "frontdesk.check_in": { description: "Check in: id, guest {firstName, lastName, mobile, email, nationality, address, birthDate, idType, idNumber}, discounts [{reservationRoomId, type SENIOR_CITIZEN|PWD, holderName, idNumber}], allowDirtyRooms.", input: z.object({ id: z.string() }).passthrough(), run: (db, ctx, a) => checkIn(db, ctx, (a as { id: string }).id, a as never) },
  "frontdesk.check_out": { description: "Check out (folio balance must be zero; rooms become Dirty): id.", input: z.object({ id: z.string() }), run: (db, ctx, a) => checkOut(db, ctx, (a as { id: string }).id) },
  "frontdesk.balance": { description: "Folio balance in centavos (zero until Phase 6): id.", input: z.object({ id: z.string() }), run: (db, ctx, a) => folioBalance(db, ctx, (a as { id: string }).id) },
  "frontdesk.discounts": { description: "Senior citizen and PWD claims of a reservation: id.", input: z.object({ id: z.string() }), run: (db, ctx, a) => discountsFor(db, ctx, (a as { id: string }).id) },
  "frontdesk.registration_card": { description: "Registration card data: id.", input: z.object({ id: z.string() }), run: (db, ctx, a) => registrationCard(db, ctx, (a as { id: string }).id) },
  "housekeeping.board": { description: "Rooms with condition, front desk status, guest and housekeeper.", input: z.object({}), run: (db, ctx) => housekeepingBoard(db, ctx) },
  "housekeeping.set_condition": { description: "Set a room's condition: roomId, condition (DIRTY|CLEAN|INSPECTED).", input: z.object({ roomId: z.string(), condition: z.enum(["DIRTY", "CLEAN", "INSPECTED"]) }), run: (db, ctx, a) => setRoomCondition(db, ctx, (a as { roomId: string }).roomId, (a as { condition: "DIRTY" }).condition) },
  "housekeeping.assign": { description: "Give a room to a housekeeper: roomId, userId (null to clear).", input: z.object({ roomId: z.string(), userId: z.string().nullable() }), run: (db, ctx, a) => assignHousekeeper(db, ctx, (a as { roomId: string }).roomId, (a as { userId: string | null }).userId) },
});
