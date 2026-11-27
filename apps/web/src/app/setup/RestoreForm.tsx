"use client";
import { startTransition, useActionState } from "react";
import { Field, Notice } from "@/components/ui";
import { restoreAction } from "./actions";

export function RestoreForm() {
  const [state, action, pending] = useActionState(restoreAction, undefined);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); startTransition(() => action(f)); }} className="mt-4 grid gap-3 sm:grid-cols-2">
      {state?.error && <div className="sm:col-span-2"><Notice kind="error">{state.error}</Notice></div>}
      <Field label="Sentire Cloud address" name="cloudUrl" defaultValue="https://pms.apps.sentire.solutions" required className="sm:col-span-2" />
      <Field label="Enrollment key" name="enrollKey" type="password" required />
      <Field label="Property web name" name="propertySlug" required hint="As in the address, e.g. bahay-kubo" />
      <Field label="Name of this hub" name="hubName" defaultValue="Front desk PC" />
      <Field label="Owner email" name="ownerEmail" type="email" required />
      <Field label="New owner password" name="password" type="password" autoComplete="new-password" required hint="Passwords are not stored in the cloud." className="sm:col-span-2" />
      <button type="submit" disabled={pending} className="h-10 rounded-control border border-line bg-surface text-[14px] font-semibold text-ink hover:bg-surface-muted disabled:opacity-60 sm:col-span-2">{pending ? "Restoring" : "Restore property"}</button>
    </form>
  );
}
