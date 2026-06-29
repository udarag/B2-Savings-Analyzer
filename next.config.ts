import { execSync } from "node:child_process";
import type { NextConfig } from "next";

const buildSha = resolveBuildSha();

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    // Surface a short, human-readable build id in the UI. "local" stays as-is so dev builds are
    // obvious; real commit SHAs are truncated to the conventional 7-char short form.
    NEXT_PUBLIC_BUILD_NUMBER: buildSha === "local" ? "local" : buildSha.slice(0, 7),
  },
  generateBuildId: async () => buildSha,
  outputFileTracingIncludes: {
    // The customer-facing PDF route renders via Playwright. Next's tracer doesn't see this asset
    // through the dynamic import, so force it into the standalone bundle or PDF generation 500s in prod.
    "/api/analyses/*/pdf": ["./node_modules/playwright-core/browsers.json"],
  },
};

/**
 * Resolve the build's commit SHA, used both as the Next build id and the displayed build number.
 * Prefers an explicitly injected SHA (CI sets one of these), falls back to asking git directly,
 * and finally "local" when neither is available (e.g. a fresh checkout with no git, or a tarball).
 */
function resolveBuildSha(): string {
  // Ordered most- to least-specific: our own override wins, then a generic CI var, then Vercel's.
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
