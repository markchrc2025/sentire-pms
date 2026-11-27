import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { makeProperty } from "@/test/fixtures";
import { createPairingCode, deviceForToken, listDevices, pairDevice, revokeDevice } from "./devices";
import { ForbiddenError, ValidationError } from "./errors";

describe.skipIf(!TEST_DATABASE_URL)("P2.3 device pairing (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let p: Awaited<ReturnType<typeof makeProperty>>;
  let q: Awaited<ReturnType<typeof makeProperty>>;
  beforeAll(async () => {
    c = await freshTestDb();
    p = await makeProperty(c.db);
    q = await makeProperty(c.db);
  });
  afterAll(async () => {
    await c?.pool.end();
  });

  it("only Admins make codes; a code pairs one device once", async () => {
    await expect(createPairingCode(c.db, p.ctx.FRONT_DESK)).rejects.toBeInstanceOf(ForbiddenError);
    const { code } = await createPairingCode(c.db, p.ctx.ADMIN);
    expect(code).toMatch(/^\d{6}$/);
    const d = await pairDevice(c.db, { code, name: "Front desk 2", kind: "WINDOWS_DESKTOP" });
    expect((await deviceForToken(c.db, d.token))?.name).toBe("Front desk 2");
    await expect(pairDevice(c.db, { code, name: "Again" })).rejects.toBeInstanceOf(ValidationError);
    expect(await listDevices(c.db, q.ctx.ADMIN)).toHaveLength(0);
  });

  it("expired codes fail and revoked devices are refused", async () => {
    const { code } = await createPairingCode(c.db, p.ctx.ADMIN);
    await expect(pairDevice(c.db, { code, name: "Late" }, {}, new Date(Date.now() + 11 * 60_000))).rejects.toBeInstanceOf(ValidationError);
    const d = await pairDevice(c.db, { code, name: "Tablet" });
    await expect(revokeDevice(c.db, q.ctx.ADMIN, d.deviceId)).rejects.toThrow();
    await revokeDevice(c.db, p.ctx.ADMIN, d.deviceId);
    expect(await deviceForToken(c.db, d.token)).toBeNull();
  });

  it("ten wrong codes in a row cancel all open codes", async () => {
    const { code } = await createPairingCode(c.db, p.ctx.ADMIN);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 10; i++) await expect(pairDevice(c.db, { code: wrong, name: "Guess" })).rejects.toBeInstanceOf(ValidationError);
    await expect(pairDevice(c.db, { code, name: "Real" })).rejects.toBeInstanceOf(ValidationError);
  });
});
