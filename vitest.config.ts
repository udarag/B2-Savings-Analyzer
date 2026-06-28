import { defineConfig } from 'vitest/config';

// Unit tests target pure functions (engine math, parsers, pricing lookups), so a
// node environment is sufficient — no jsdom/React. `resolve.tsconfigPaths` makes
// the `@/*` alias used throughout src/ resolve the same way it does in the app
// (Vite resolves tsconfig paths natively, so no extra plugin is needed).
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
