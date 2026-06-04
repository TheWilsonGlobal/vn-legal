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
    exclude: ["node_modules", "dist"],
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
