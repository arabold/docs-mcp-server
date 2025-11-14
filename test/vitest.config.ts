import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    // Define PostHog API key for telemetry - empty for tests
    '__POSTHOG_API_KEY__': JSON.stringify(''),
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30000, // 30 seconds for network operations
    include: ["test/**/*.test.ts"],
    setupFiles: ["./setup.ts"],
    // // Allow parallel execution with reasonable concurrency
    // maxConcurrency: 5, // Limit concurrent tests to be respectful to target sites
    // Add retry for flaky network tests
    // retry: 1,
  },
});
