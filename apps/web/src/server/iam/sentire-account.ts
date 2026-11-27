import { randomBytes } from "node:crypto";
import { eq, or } from "drizzle-orm";
import type { Db } from "@sentire-pms/db";
import { auditLog, sessions, users } from "@sentire-pms/db/schema";
import { hashToken, SESSION_HOURS } from "./auth";

/**
 * Sign-in with Sentire Account (Frappe OAuth2 / OpenID). Turned on only when SENTIRE_ACCOUNT_URL,
 * SENTIRE_ACCOUNT_CLIENT_ID and SENTIRE_ACCOUNT_SECRET are set. Only links to staff accounts that
 * already exist (matched by Sentire Account id, then email); it never creates users.
 */
export function sentireAccountEnabled(): boolean {
  return Boolean(process.env.SENTIRE_ACCOUNT_URL && process.env.SENTIRE_ACCOUNT_CLIENT_ID && process.env.SENTIRE_ACCOUNT_SECRET);
}

function cfg() {
  const issuer = process.env.SENTIRE_ACCOUNT_URL!.replace(/\/$/, "");
  const base = `${issuer}/api/method/frappe.integrations.oauth2`;
  return {
    clientId: process.env.SENTIRE_ACCOUNT_CLIENT_ID!,
    secret: process.env.SENTIRE_ACCOUNT_SECRET!,
    redirectUri: `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/api/auth/sentire/callback`,
    authorize: `${base}.authorize`,
    token: `${base}.get_token`,
    userinfo: `${base}.openid_profile`,
  };
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

export function authorizeUrl(state: string): string {
  const c = cfg();
  const q = new URLSearchParams({ client_id: c.clientId, response_type: "code", scope: "openid all", redirect_uri: c.redirectUri, state });
  return `${c.authorize}?${q}`;
}

export async function exchangeAndSignIn(db: Db, code: string): Promise<{ ok: true; token: string; expiresAt: Date; userId: string } | { ok: false; error: string }> {
  const c = cfg();
  const tr = await fetch(c.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: c.redirectUri, client_id: c.clientId, client_secret: c.secret }),
  });
  if (!tr.ok) return { ok: false, error: "Sentire Account did not accept the sign-in." };
  const { access_token } = (await tr.json()) as { access_token?: string };
  const ur = await fetch(c.userinfo, { headers: { authorization: `Bearer ${access_token}` } });
  if (!ur.ok) return { ok: false, error: "Could not read your Sentire Account profile." };
  const info = (await ur.json()) as { sub?: string; email?: string };
  if (!info.sub) return { ok: false, error: "Sentire Account profile has no id." };
  const email = info.email?.toLowerCase();
  const [u] = await db.select().from(users).where(email ? or(eq(users.sentireAccountId, info.sub), eq(users.email, email)) : eq(users.sentireAccountId, info.sub)).limit(1);
  if (!u || !u.active) return { ok: false, error: "No staff account here for that Sentire Account. Ask your property owner." };
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  await db.transaction(async (tx) => {
    if (!u.sentireAccountId) await tx.update(users).set({ sentireAccountId: info.sub }).where(eq(users.id, u.id));
    await tx.insert(sessions).values({ userId: u.id, tokenHash: hashToken(token), expiresAt });
    await tx.insert(auditLog).values({ organizationId: u.organizationId, actorUserId: u.id, action: "user.signed_in", entity: "user", entityId: u.id, before: null, after: { via: "sentire_account" } });
  });
  return { ok: true, token, expiresAt, userId: u.id };
}
