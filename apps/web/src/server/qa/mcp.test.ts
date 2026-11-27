import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";


describe.skipIf(!TEST_DATABASE_URL)("QA connector (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let mcp: typeof import("./mcp");
  beforeAll(async () => {
    c = await freshTestDb();
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.PMS_QA_KEY = "k-test-123";
    process.env.PMS_SEED_DEMO = "1";
    mcp = await import("./mcp");
  });
  afterAll(async () => {
    await c?.pool.end();
  });
  const call = async (name: string, args: object) => {
    const r = (await mcp.handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })) as { result: { isError?: boolean; content: { text: string }[] } };
    return { err: r.result.isError, body: r.result.isError ? r.result.content[0]!.text : JSON.parse(r.result.content[0]!.text) };
  };

  it("is gated by the key", () => {
    expect(mcp.qaEnabled()).toBe(true);
    expect(mcp.qaKeyMatches("k-test-123")).toBe(true);
    expect(mcp.qaKeyMatches("wrong")).toBe(false);
  });

  it("lists tools and resets staging", async () => {
    const r = (await mcp.handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
    expect(r.result.tools.map((t) => t.name)).toContain("run_operation");
    expect((await call("reset_staging", { confirm: "no" })).err).toBe(true);
    expect((await call("reset_staging", { confirm: "RESET" })).body.reset).toBe(true);
    const st = await call("staging_status", {});
    expect(st.body.property.slug).toBe("bahay-kubo-marikina");
  });

  it("runs operations with the app's own permission checks", async () => {
    const denied = await call("run_operation", { operation: "property.update", as_role: "FRONT_DESK", args: { name: "X" } });
    expect(denied.body.refused).toBe(true);
    const ok = await call("run_operation", { operation: "property.update", as_role: "ADMIN", args: { address: "Marikina" } });
    expect(ok.body.ok).toBe(true);
  });
});
