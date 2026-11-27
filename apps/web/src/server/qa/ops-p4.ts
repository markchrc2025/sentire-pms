import { z } from "zod";
import type { ResStatus } from "@sentire-pms/core";
import { createGuest, getGuest, searchGuests, updateGuest } from "../guests";
import { activityLog, addBookedRoom, addNote, assignRoom, cancellationPreview, changeBookedRoom, changeDates, createReservation, freeRoomsFor, getReservation, listReservations, removeBookedRoom, transition } from "../reservations";
import { calendarData } from "../calendar";
import { dashboard } from "../dashboard";
import { registerOperations } from "./operations";

const any = z.record(z.string(), z.unknown());
const id = z.object({ id: z.string() });

registerOperations({
  "guest.search": { description: "Search guests: q.", input: z.object({ q: z.string().default("") }), run: (db, ctx, a) => searchGuests(db, ctx, (a as { q: string }).q) },
  "guest.get": { description: "A guest and their stays: id.", input: id, run: (db, ctx, a) => getGuest(db, ctx, (a as { id: string }).id) },
  "guest.create": { description: "Create a guest: firstName, lastName, email, mobile, nationality, address, company, notes.", input: any, run: (db, ctx, a) => createGuest(db, ctx, a) },
  "guest.update": { description: "Update a guest: id plus the create fields.", input: any, run: (db, ctx, a) => updateGuest(db, ctx, String((a as { id: string }).id), a) },
  "reservation.create": { description: "Create: source, status (INQUIRY|NOT_CONFIRMED|CONFIRMED), checkIn, checkOut, guestId or guest {...}, rooms [{roomTypeId, ratePlanId, adults, children, roomId?}], notes, overbook, ignoreRestrictions.", input: any, run: (db, ctx, a) => createReservation(db, ctx, a as never) },
  "reservation.get": { description: "Reservation with guest, rooms, nights and notes: id.", input: id, run: (db, ctx, a) => getReservation(db, ctx, (a as { id: string }).id) },
  "reservation.list": { description: "List and search: q, status [], from, to, source, roomTypeId, page.", input: any, run: (db, ctx, a) => listReservations(db, ctx, a as never) },
  "reservation.transition": { description: "Change status: id, to (CONFIRMED|NOT_CONFIRMED|CHECKED_IN|CHECKED_OUT|CANCELLED|NO_SHOW), reason, allowDirtyRooms.", input: z.object({ id: z.string(), to: z.string(), reason: z.string().optional(), allowDirtyRooms: z.boolean().optional() }), run: (db, ctx, a) => { const x = a as { id: string; to: ResStatus; reason?: string; allowDirtyRooms?: boolean }; return transition(db, ctx, x.id, x.to, x); } },
  "reservation.cancellation_preview": { description: "Penalty if cancelled now: id.", input: id, run: (db, ctx, a) => cancellationPreview(db, ctx, (a as { id: string }).id) },
  "reservation.assign_room": { description: "Assign or move: reservationRoomId, roomId (null to unassign).", input: z.object({ reservationRoomId: z.string(), roomId: z.string().nullable() }), run: (db, ctx, a) => { const x = a as { reservationRoomId: string; roomId: string | null }; return assignRoom(db, ctx, x.reservationRoomId, x.roomId); } },
  "reservation.free_rooms": { description: "Rooms free for a booked room: reservationRoomId.", input: z.object({ reservationRoomId: z.string() }), run: (db, ctx, a) => freeRoomsFor(db, ctx, (a as { reservationRoomId: string }).reservationRoomId) },
  "reservation.change_dates": { description: "Change dates (re-prices): id, checkIn, checkOut, overbook, ignoreRestrictions.", input: any, run: (db, ctx, a) => changeDates(db, ctx, String((a as { id: string }).id), a as never) },
  "reservation.change_room": { description: "Change a booked room: reservationRoomId, roomTypeId, ratePlanId, adults, children.", input: any, run: (db, ctx, a) => changeBookedRoom(db, ctx, String((a as { reservationRoomId: string }).reservationRoomId), a as never) },
  "reservation.add_room": { description: "Add a room: id, roomTypeId, ratePlanId, adults, children.", input: any, run: (db, ctx, a) => addBookedRoom(db, ctx, String((a as { id: string }).id), a as never) },
  "reservation.remove_room": { description: "Remove a booked room: reservationRoomId.", input: z.object({ reservationRoomId: z.string() }), run: (db, ctx, a) => removeBookedRoom(db, ctx, (a as { reservationRoomId: string }).reservationRoomId) },
  "reservation.add_note": { description: "Add a note: id, body.", input: z.object({ id: z.string(), body: z.string() }), run: (db, ctx, a) => addNote(db, ctx, (a as { id: string }).id, (a as { body: string }).body) },
  "reservation.activity": { description: "Activity log: id.", input: id, run: (db, ctx, a) => activityLog(db, ctx, (a as { id: string }).id) },
  "calendar.data": { description: "Calendar grid data: from, days (7|14|30).", input: z.object({ from: z.string(), days: z.number().int() }), run: (db, ctx, a) => calendarData(db, ctx, (a as { from: string }).from, (a as { days: number }).days) },
  "dashboard.get": { description: "Dashboard counts, lists, occupancy and 14-day forecast for the business date.", input: z.object({}), run: (db, ctx) => dashboard(db, ctx) },
});
