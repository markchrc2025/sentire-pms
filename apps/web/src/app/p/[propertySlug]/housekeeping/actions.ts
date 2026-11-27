"use server";
import { runAction, type ActionState } from "@/server/actions";
import { assignHousekeeper, setRoomCondition } from "@/server/frontdesk";

export async function conditionAction(slug: string, roomId: string, condition: "DIRTY" | "CLEAN" | "INSPECTED", _p: ActionState) {
  return runAction(slug, async (db, ctx) => {
    const r = await setRoomCondition(db, ctx, roomId, condition);
    return `Room ${r.number} is ${condition.toLowerCase()}.`;
  });
}

export async function housekeeperAction(slug: string, roomId: string, _p: ActionState, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await assignHousekeeper(db, ctx, roomId, String(f.get("userId") ?? "") || null);
    return "Saved.";
  });
}
