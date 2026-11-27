"use client";
import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/server/actions";
import { Notice } from "./index";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/** A form bound to a server action that shows the result message. resetOnOk clears it after success. */
export function ActionForm({ action, children, submitLabel = "Save", className = "", resetOnOk = false, inline = false, variant = "primary", confirm }: {
  action: Action;
  children?: ReactNode;
  submitLabel?: string;
  className?: string;
  resetOnOk?: boolean;
  inline?: boolean;
  variant?: "primary" | "secondary" | "danger";
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnOk) ref.current?.reset();
  }, [state, resetOnOk]);
  const btn = {
    primary: "bg-accent text-white hover:bg-accent-hover border-transparent",
    secondary: "bg-surface text-ink border-line hover:bg-surface-muted",
    danger: "bg-surface text-[#991b1b] border-[#fecaca] hover:bg-[#fef2f2]",
  }[variant];
  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        // Submit manually so React does not clear the form when the server refuses the input.
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className={inline ? `inline-flex flex-nowrap items-center gap-2 ${className}` : `flex flex-col gap-3 ${className}`}
    >
      {children}
      <div className={inline ? "inline-flex items-center gap-2" : "flex flex-wrap items-center gap-3"}>
        <button type="submit" disabled={pending} className={`inline-flex h-9 items-center rounded-control border px-3.5 text-[13px] font-semibold disabled:opacity-50 ${btn}`}>
          {pending ? "Working" : submitLabel}
        </button>
        {state?.error && (inline ? <span role="alert" className="text-[12px] text-[#991b1b]">{state.error}</span> : <Notice kind="error">{state.error}</Notice>)}
        {state?.ok && !inline && <span role="status" className="text-[13px] text-[#166534]">{state.ok}</span>}
      </div>
    </form>
  );
}
