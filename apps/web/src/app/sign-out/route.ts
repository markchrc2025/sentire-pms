import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getDb } from "@sentire-pms/db";
import { SESSION_COOKIE, signOut } from "@/server/iam/auth";

export async function POST(req: Request) {
  const jar = await cookies();
  await signOut(getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/sign-in", req.url), 303);
}
