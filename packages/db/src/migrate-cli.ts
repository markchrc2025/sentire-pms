import { runMigrations } from "./index";

runMigrations()
  .then(() => {
    console.log("[db] migrations applied");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[db] migration failed", err);
    process.exit(1);
  });
