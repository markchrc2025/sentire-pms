import "server-only";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { isCloud } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { properties, users } from "@sentire-pms/db/schema";
import { requireTenant } from "../iam/request";
import { propertiesForUser } from "../iam/auth";

export interface ShellContext {
  propertySlug: string;
  propertyName: string;
  businessDate: string;
  properties: { slug: string; name: string; role: string }[];
  userName: string;
  userInitials: string;
  role: string;
}

/** Data the app shell needs. The staff app runs on the hub only and needs a signed-in user with a role at the property. */
export async function getShellContext(propertySlug: string): Promise<ShellContext> {
  if (isCloud()) notFound();
  const ctx = await requireTenant(propertySlug);
  const db = getDb();
  const [p] = await db.select().from(properties).where(eq(properties.id, ctx.propertyId)).limit(1);
  if (!p) notFound();
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).limit(1);
  const name = u?.name ?? "";
  const props = await propertiesForUser(db, ctx.userId);
  return {
    propertySlug,
    propertyName: p.name,
    businessDate: formatDate(p.businessDate),
    properties: props.map((x) => ({ slug: x.slug, name: x.name, role: labelRole(x.role) })),
    userName: name,
    userInitials: name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?",
    role: labelRole(ctx.role),
  };
}

export function labelRole(r: string): string {
  return { OWNER: "Owner", ADMIN: "Admin", FRONT_DESK: "Front desk", HOUSEKEEPING: "Housekeeping", ACCOUNTANT: "Accountant" }[r] ?? r;
}

/** "24 Nov 2026" from an ISO date. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
