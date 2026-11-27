import "server-only";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getDb, type Db } from "@sentire-pms/db";
import { requireTenant } from "./iam/request";
import type { TenantContext } from "./iam/tenant";
import { isDomainError } from "./iam/errors";

export type ActionState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; at?: number } | undefined;

/**
 * Run a server action for the staff app: resolve the tenant from the session and the URL, run the
 * service, and turn validation and domain errors into a message for the form.
 */
export async function runAction(propertySlug: string, fn: (db: Db, ctx: TenantContext) => Promise<string | void>, revalidate = true): Promise<ActionState> {
  const ctx = await requireTenant(propertySlug);
  try {
    const ok = await fn(getDb(), ctx);
    if (revalidate) revalidatePath(`/p/${propertySlug}`, "layout");
    return { ok: ok || "Saved.", at: Date.now() };
  } catch (e) {
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) {
        const k = String(i.path[0] ?? "");
        if (k && !fieldErrors[k]) fieldErrors[k] = i.message;
      }
      return { error: e.issues[0]?.message ?? "Check the form.", fieldErrors, at: Date.now() };
    }
    if (isDomainError(e)) return { error: e.message, at: Date.now() };
    console.error("[action]", e);
    return { error: "Something went wrong. Nothing was saved.", at: Date.now() };
  }
}

/** FormData to a plain object (last value wins; checkboxes missing when unticked). */
export function formObject(form: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) o[k] = v;
  return o;
}
