"use server";
import { redirect } from "next/navigation";
import { getDb } from "@sentire-pms/db";
import { isCloud } from "@sentire-pms/core";
import { firstRunSetup } from "@/server/iam/auth";

export async function setupAction(_p: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  if (isCloud()) return { error: "Setup runs on the property hub only." };
  const r = await firstRunSetup(getDb(), Object.fromEntries(form));
  if (!r.ok) return { error: r.error };
  redirect("/sign-in");
}
