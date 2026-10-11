/**
 * Setup file for e2e tests that use the mock server.
 *
 * The global `vi.mock("../src/utils/logger")` is applied in setup-env.ts
 * (which runs first), so it is not repeated here.
 */

import { afterAll, afterEach, beforeAll } from "vitest";
import { mayPassThrough, server } from "./mock-server";

// Start mock server before all tests
beforeAll(() => {
  server.listen({
    // mock-server.ts answers every HTTP request itself, so only WebSocket
    // connections, which have no handlers, arrive here. The same rule applies:
    // loopback (or an opt-in live suite) goes through, anything else fails
    // instead of reaching the network.
    onUnhandledRequest(request, print) {
      if (mayPassThrough(new URL(request.url).hostname)) {
        return;
      }
      print.error();
      throw new Error(`Unmocked connection in a test: ${request.url}`);
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
