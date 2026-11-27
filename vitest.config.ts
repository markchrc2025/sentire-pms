import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "apps/web/src"), "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts") } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/src/**/*.test.ts", "tests/unit/**/*.test.ts", "tests/sync/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
