export type PmsMode = "hub" | "cloud";

/** Run mode from PMS_MODE. Defaults to hub, because the hub is where staff work. */
export function pmsMode(env: Record<string, string | undefined> = process.env): PmsMode {
  const v = (env.PMS_MODE ?? "hub").toLowerCase();
  if (v !== "hub" && v !== "cloud") throw new Error(`PMS_MODE must be "hub" or "cloud", got "${v}"`);
  return v;
}

export const isHub = (env?: Record<string, string | undefined>) => pmsMode(env) === "hub";
export const isCloud = (env?: Record<string, string | undefined>) => pmsMode(env) === "cloud";
