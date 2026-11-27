export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) {
    console.warn("[boot] DATABASE_URL not set, skipping migrations");
    return;
  }
  const { runMigrations } = await import("@sentire-pms/db");
  await runMigrations();
  console.log(`[boot] migrations applied (mode ${process.env.PMS_MODE ?? "hub"})`);
}
