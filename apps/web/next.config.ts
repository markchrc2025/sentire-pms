import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  poweredByHeader: false,
  transpilePackages: ["@sentire-pms/core", "@sentire-pms/db", "@sentire-pms/sync", "@sentire-pms/ui"],
  serverExternalPackages: ["pg"],
  outputFileTracingIncludes: { "/*": ["../../packages/db/drizzle/**/*"] },
};

export default nextConfig;
