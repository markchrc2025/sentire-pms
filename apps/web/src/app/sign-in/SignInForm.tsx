"use client";
import { useActionState } from "react";
import { Field, Notice } from "@/components/ui";
import { signInAction } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="mt-5 flex flex-col gap-3">
      {state?.error && <Notice kind="error">{state.error}</Notice>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field key={state?.email} label="Email" name="email" type="email" autoComplete="username" defaultValue={state?.email} required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit" disabled={pending} className="mt-1 h-10 rounded-control bg-accent text-[14px] font-semibold text-white hover:bg-accent-hover disabled:opacity-60">
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
