"use server";
import { formObject, runAction, type ActionState } from "@/server/actions";
import { enrollFromScreen, setIssueStatus, syncNow } from "@/server/sync/admin";
import { createPairingCode, revokeDevice } from "@/server/iam/devices";

type S = ActionState;

export async function enrollAction(slug: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await enrollFromScreen(db, ctx, formObject(f));
    return "Connected. The first sync sends the whole property to Sentire Cloud.";
  });
}

export async function syncNowAction(slug: string, _p: S) {
  return runAction(slug, async (db, ctx) => {
    const r = await syncNow(db, ctx);
    return r.ok ? `Synced: ${r.pushed} sent, ${r.pulled} received${r.rejected ? `, ${r.rejected} refused` : ""}.` : `Sync failed: ${r.error}. It retries on its own.`;
  });
}

export async function issueAction(slug: string, id: string, status: "RESOLVED" | "IGNORED", _p: S) {
  return runAction(slug, async (db, ctx) => void (await setIssueStatus(db, ctx, id, status)));
}

export async function pairingCodeAction(slug: string, _p: S) {
  return runAction(slug, async (db, ctx) => {
    const c = await createPairingCode(db, ctx);
    return `Pairing code ${c.code.slice(0, 3)} ${c.code.slice(3)}. It works once, for 10 minutes.`;
  }, false);
}

export async function revokeDeviceAction(slug: string, id: string, _p: S) {
  return runAction(slug, async (db, ctx) => void (await revokeDevice(db, ctx, id)));
}
