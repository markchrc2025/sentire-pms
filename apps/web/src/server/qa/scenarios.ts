import type { Db } from "@sentire-pms/db";
import type { TenantContext } from "../iam/tenant";

export interface Scenario {
  description: string;
  run: (db: Db, ctx: TenantContext, tag: string) => Promise<unknown>;
}

/** Named test scenarios for UAT. Each phase registers its own in register-all.ts. */
export const SCENARIOS: Record<string, Scenario> = {};

export function registerScenarios(s: Record<string, Scenario>) {
  Object.assign(SCENARIOS, s);
}
