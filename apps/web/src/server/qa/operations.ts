import { z } from "zod";
import type { Db } from "@sentire-pms/db";
import type { TenantContext } from "../iam/tenant";
import { getProperty, updatePropertyDetails } from "../property";

export interface Operation {
  description: string;
  input: z.ZodType;
  run: (db: Db, ctx: TenantContext, args: unknown) => Promise<unknown>;
}

/**
 * Service functions the QA connector may call, as a chosen demo role. They are the same functions
 * the screens use, so permissions and validation are the app's own. Each phase adds its own.
 */
export const OPERATIONS: Record<string, Operation> = {
  "property.get": { description: "Read the property.", input: z.object({}), run: (db, ctx) => getProperty(db, ctx) },
  "property.update": {
    description: "Update property details (name, registeredName, tin, branchCode, address).",
    input: z.record(z.string(), z.unknown()),
    run: (db, ctx, a) => updatePropertyDetails(db, ctx, a as never),
  },
};

export function registerOperations(ops: Record<string, Operation>) {
  Object.assign(OPERATIONS, ops);
}
