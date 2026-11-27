import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@sentire-pms/db";
import { propertiesForUser, SESSION_COOKIE } from "@/server/iam/auth";
import { exchangeAndSignIn, sentireAccountEnabled } from "@/server/iam/sentire-account";
import { secureCookies } from "@/server/iam/request";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get("pms_oauth_state")?.value;
  jar.delete("pms_oauth_state");
  const fail = (m: string) => NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(m)}`, req.url));
  if (!sentireAccountEnabled()) return fail("Sentire Account sign-in is not turned on.");
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return fail("The sign-in link expired. Try again.");
  const r = await exchangeAndSignIn(getDb(), code);
  if (!r.ok) return fail(r.error);
  jar.set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", expires: r.expiresAt });
  const props = await propertiesForUser(getDb(), r.userId);
  return NextResponse.redirect(new URL(props[0] ? `/p/${props[0].slug}` : "/no-access", req.url));
}
