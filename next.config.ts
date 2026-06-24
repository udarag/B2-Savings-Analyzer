import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/analyses/*/pdf": ["./node_modules/playwright-core/browsers.json"],
  },
};

export default nextConfig;
