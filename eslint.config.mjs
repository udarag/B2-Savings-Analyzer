import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local-only build/sync artifacts that aren't source. ".next/**" matches only the top-level
    // build dir, so nested build output inside ignored worktrees would otherwise flood the lint
    // run with thousands of phantom errors.
    ".claude/**",
    "**/.next/**",
  ]),
]);

export default eslintConfig;
