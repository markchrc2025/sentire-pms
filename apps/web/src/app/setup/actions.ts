"use server";
import { redirect } from "next/navigation";
import { getDb } from "@sentire-pms/db";
import { isCloud } from "@sentire-pms/core";
import { firstRunSetup } from "@/server/iam/auth";
import { cookies } from "next/headers";
import { DEVICE_COOKIE, pairSetupDevice } from "@/server/iam/devices";
import { requestMeta, secureCookies } from "@/server/iam/request";

export async function setupAction(_p: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  if (isCloud()) return { error: "Setup runs on the property hub only." };
  const r = await firstRunSetup(getDb(), Object.fromEntries(form));
  if (!r.ok) return { error: r.error };
  // The PC that set up the hub becomes its first paired device.
  const token = await pairSetupDevice(getDb(), (await requestMeta()).userAgent);
  (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 400 * 86_400 });
  redirect("/sign-in");
}

export async function restoreAction(_p: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  if (isCloud()) return { error: "Restore runs on the property hub only." };
  const { restoreFromCloud, httpTransport } = await import("@/server/sync/hub");
  const cloudUrl = String(form.get("cloudUrl") ?? "").trim();
  try {
    await restoreFromCloud(getDb(), httpTransport(cloudUrl), {
      cloudUrl,
      enrollKey: String(form.get("enrollKey") ?? ""),
      hubName: String(form.get("hubName") ?? "Hub"),
      propertySlug: String(form.get("propertySlug") ?? "").trim().toLowerCase(),
      ownerEmail: String(form.get("ownerEmail") ?? ""),
      ownerPassword: String(form.get("password") ?? ""),
    });
  } catch (e) {
    return { error: (e as Error).message };
  }
  const token = await pairSetupDevice(getDb(), (await requestMeta()).userAgent);
  (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 400 * 86_400 });
  redirect("/sign-in");
}
