"use client";
import { useActionState } from "react";
import { Field, Notice } from "@/components/ui";
import { setupAction } from "./actions";

export function SetupForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(setupAction, undefined);
  return (
    <form action={action} className="mt-5 grid gap-3 sm:grid-cols-2">
      {state?.error && <div className="sm:col-span-2"><Notice kind="error">{state.error}</Notice></div>}
      <Field label="Company name" name="organizationName" required className="sm:col-span-2" />
      <Field label="Property name" name="propertyName" required />
      <Field label="Short web name" name="propertySlug" required hint="Lowercase and dashes, e.g. bahay-kubo" />
      <Field label="First business date" name="businessDate" type="date" defaultValue={today} required />
      <Field label="Your name" name="ownerName" required />
      <Field label="Your email" name="ownerEmail" type="email" required />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required hint="At least 10 characters with a number" />
      <button type="submit" disabled={pending} className="h-10 rounded-control bg-accent text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60 sm:col-span-2">
        {pending ? "Setting up" : "Set up this hub"}
      </button>
    </form>
  );
}
