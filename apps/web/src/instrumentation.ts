export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) {
    console.warn("[boot] DATABASE_URL not set, skipping migrations");
    return;
  }
  const { runMigrations, seedDemo, getDb } = await import("@sentire-pms/db");
  await runMigrations();
  console.log(`[boot] migrations applied (mode ${process.env.PMS_MODE ?? "hub"})`);
  if (process.env.PMS_SEED_DEMO === "1") {
    const seeded = await seedDemo(getDb());
    console.log(seeded ? "[boot] demo property seeded" : "[boot] demo seed skipped, properties exist");
  }
}
