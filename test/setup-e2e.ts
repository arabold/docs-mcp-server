/**
 * Setup file for e2e tests that use the mock server.
 *
 * The global `vi.mock("../src/utils/logger")` is applied in setup-env.ts
 * (which runs first), so it is not repeated here.
 */

import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mock-server";

// Start mock server before all tests
beforeAll(() => {
  server.listen({
    onUnhandledRequest(request, print) {
      if (
        request.url.includes("127.0.0.1") ||
        request.url.includes("localhost") ||
        request.url.includes("clerk.accounts.dev") ||
        request.url.includes("worker.example.com")
      ) {
        return;
      }
      print.warning();
    },
  });
});

// Reset handlers after each test to ensure test isolation
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
