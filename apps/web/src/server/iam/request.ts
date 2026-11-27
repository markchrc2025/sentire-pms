import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getDb } from "@sentire-pms/db";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./auth";
import { resolveTenant, type TenantContext } from "./tenant";
import { NotFoundError } from "./errors";

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser(): Promise<SessionUser> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await userForToken(getDb(), token);
  if (!user) redirect("/sign-in");
  return user;
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return userForToken(getDb(), token);
}

/**
 * Tenant for this request: the signed-in user at the property in the URL. Every server action and
 * page in the staff app starts with this, then authorize(ctx, permission).
 */
export async function requireTenant(propertySlug: string): Promise<TenantContext> {
  const user = await requireUser();
  try {
    return await resolveTenant(getDb(), { userId: user.userId, propertySlug });
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export async function requestMeta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? undefined, userAgent: h.get("user-agent") ?? undefined };
}

export function secureCookies(): boolean {
  return (process.env.APP_URL ?? "").startsWith("https://");
}
