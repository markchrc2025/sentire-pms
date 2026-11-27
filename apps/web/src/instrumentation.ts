export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) {
    console.warn("[boot] DATABASE_URL not set, skipping migrations");
    return;
  }
  const { runMigrations, seedDemo, getDb } = await import("@sentire-pms/db");
  await runMigrations();
  console.log(`[boot] migrations applied (mode ${process.env.PMS_MODE ?? "hub"})`);
  if (process.env.PMS_SEED_DEMO === "1" && process.env.PMS_MODE !== "cloud") {
    await import("./server/demo");
    const seeded = await seedDemo(getDb());
    console.log(seeded ? "[boot] demo property created and seeded" : "[boot] demo data checked (missing parts added, existing data kept)");
  }
  if (process.env.PMS_MODE !== "cloud" && process.env.PMS_SYNC_IN_PROCESS !== "0") {
    const { startSyncLoop } = await import("./server/sync/loop");
    startSyncLoop();
    console.log("[boot] sync loop started in the app process");
  }
}
