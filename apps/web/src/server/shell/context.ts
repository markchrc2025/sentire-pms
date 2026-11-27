import "server-only";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { isCloud } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { properties } from "@sentire-pms/db/schema";

export interface ShellContext {
  propertySlug: string;
  propertyName: string;
  businessDate: string;
  properties: { slug: string; name: string; role: string }[];
  userInitials: string;
}

/**
 * Data the app shell needs. The staff app runs on the hub only. Until sign-in lands (PMS-5) the
 * shell is shown only when PMS_DEMO_SHELL=1 (development and the staging hub); otherwise every
 * staff page redirects to sign-in, so nothing is exposed.
 */
export async function getShellContext(propertySlug: string): Promise<ShellContext> {
  if (isCloud()) notFound();
  if (process.env.PMS_DEMO_SHELL !== "1") redirect("/sign-in");
  if (!process.env.DATABASE_URL) {
    return { propertySlug, propertyName: "Demo property", businessDate: "Not set", properties: [], userInitials: "SP" };
  }
  const db = getDb();
  const [p] = await db.select().from(properties).where(eq(properties.slug, propertySlug)).limit(1);
  if (!p || !p.active) notFound();
  return {
    propertySlug,
    propertyName: p.name,
    businessDate: formatDate(p.businessDate),
    properties: [{ slug: p.slug, name: p.name, role: "Demo" }],
    userInitials: "SP",
  };
}

/** "24 Nov 2026" from an ISO date. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
