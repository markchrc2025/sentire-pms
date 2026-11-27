"use client";
import { startTransition, useActionState } from "react";
import { Field, Notice, Select } from "@/components/ui";
import { pairAction } from "./actions";

export function PairForm() {
  const [state, action, pending] = useActionState(pairAction, undefined);
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); startTransition(() => action(f)); }} className="mt-5 flex flex-col gap-3">
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      <Field label="Pairing code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required hint="An Admin makes this code on Settings, Sync and devices." />
      <Field label="Device name" name="name" placeholder="Front desk 2" required />
      <Select label="Device type" name="kind" options={[{ value: "WINDOWS_DESKTOP", label: "Windows PC" }, { value: "ANDROID_TABLET", label: "Android tablet" }, { value: "IPAD", label: "iPad" }, { value: "BROWSER", label: "Other browser" }]} />
      <button type="submit" disabled={pending} className="h-10 rounded-control bg-accent text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60">{pending ? "Pairing" : "Pair this device"}</button>
    </form>
  );
}
