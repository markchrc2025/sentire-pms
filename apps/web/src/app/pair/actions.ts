"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getDb } from "@sentire-pms/db";
import { DEVICE_COOKIE, pairDevice } from "@/server/iam/devices";
import { isDomainError } from "@/server/iam/errors";
import { requestMeta, secureCookies } from "@/server/iam/request";

export async function pairAction(_p: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  try {
    const r = await pairDevice(getDb(), { code: form.get("code"), name: form.get("name"), kind: form.get("kind") || "BROWSER" }, await requestMeta());
    (await cookies()).set(DEVICE_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 400 * 86_400 });
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues[0]?.message };
    if (isDomainError(e)) return { error: e.message };
    throw e;
  }
  redirect("/sign-in");
}
