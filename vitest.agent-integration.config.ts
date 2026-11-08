import { defineConfig } from "vitest/config";

// Agent integration tests (spawn real servers). Run with: pnpm run test:agent-integration
// Standalone, not mergeConfig(base): mergeConfig concatenates `include` arrays, which
// would also run the default unit and integration globs.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["apps/server/tests/integration/agent/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 120000,
    hookTimeout: 120000,
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true, minThreads: 1, maxThreads: 1 },
    },
    isolate: true,
    setupFiles: ["./apps/server/tests/setup-unit.ts"],
  },
});
