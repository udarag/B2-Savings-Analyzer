import { execSync } from "node:child_process";
import type { NextConfig } from "next";

const buildSha = resolveBuildSha();

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_NUMBER: buildSha === "local" ? "local" : buildSha.slice(0, 7),
  },
  generateBuildId: async () => buildSha,
  outputFileTracingIncludes: {
    "/api/analyses/*/pdf": ["./node_modules/playwright-core/browsers.json"],
  },
};

function resolveBuildSha(): string {
  const configuredSha =
    process.env.B2SA_BUILD_SHA ||
    process.env.GIT_HASH ||
    process.env.VERCEL_GIT_COMMIT_SHA;

  if (configuredSha?.trim()) {
    return configuredSha.trim();
  }

  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
}

export default nextConfig;
