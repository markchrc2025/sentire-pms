"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@sentire-pms/db";
import { propertiesForUser, SESSION_COOKIE, signIn } from "@/server/iam/auth";
import { requestMeta, requirePairedDevice, secureCookies } from "@/server/iam/request";

export async function signInAction(_prev: { error?: string; email?: string } | undefined, form: FormData): Promise<{ error?: string; email?: string }> {
  await requirePairedDevice();
  const db = getDb();
  const r = await signIn(db, { email: form.get("email"), password: form.get("password") }, await requestMeta());
  if (!r.ok) return { error: r.error, email: String(form.get("email") ?? "") };
  (await cookies()).set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", expires: r.expiresAt });
  const props = await propertiesForUser(db, r.userId);
  const next = String(form.get("next") ?? "");
  if (next.startsWith("/p/") && !next.startsWith("//")) redirect(next);
  redirect(props[0] ? `/p/${props[0].slug}` : "/no-access");
}
