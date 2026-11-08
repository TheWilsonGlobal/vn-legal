import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "apps/server/tests/unit/**/*.test.ts",
      "apps/server/tests/integration/**/*.test.ts",
      "apps/server/src/**/*.test.ts",
    ],
    // Live agent integration tests spawn servers and need VN_LEGAL_LIVE=1 (plan r5 R0-04).
    // They run through `pnpm run test:agent-integration` (vitest.agent-integration.config.ts).
    exclude: ["node_modules", "dist", "apps/server/tests/integration/agent/**"],
    testTimeout: 120000,
    hookTimeout: 120000,
    // Increase pool timeouts to prevent worker crashes on long-running tests
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: true, // Run integration tests sequentially to avoid resource contention
        minThreads: 1,
        maxThreads: 1,
      },
    },
    // Isolate test files to prevent mock interference between unit and integration tests
    isolate: true,
    setupFiles: ["./apps/server/tests/setup-unit.ts"],
    // Integration tests have their own setup to ensure real congraphdb is used
    // This is handled by setup-integration.ts imported in integration test files
    coverage: {
      provider: "v8",
      include: ["apps/server/src/**/*.ts"],
      exclude: [
        "apps/server/src/scripts/**",
        "apps/server/src/index.ts",
        "apps/server/src/shared/types.ts",
        "apps/server/src/retrieval/types.ts",
        "apps/server/src/graph/index.ts",
      ],
      reporter: ["text", "text-summary", "html"],
    },
  },
});
