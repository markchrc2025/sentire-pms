import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { authorizeUrl, newState, sentireAccountEnabled } from "@/server/iam/sentire-account";
import { secureCookies } from "@/server/iam/request";

export async function GET(req: Request) {
  if (!sentireAccountEnabled()) return NextResponse.redirect(new URL("/sign-in", req.url));
  const state = newState();
  (await cookies()).set("pms_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(state));
}
