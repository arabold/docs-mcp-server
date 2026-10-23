/**
 * Setup file for e2e tests that use the mock server.
 *
 * The global `vi.mock("../src/utils/logger")` is applied in setup-env.ts
 * (which runs first), so it is not repeated here.
 */

import http from "node:http";
import https from "node:https";
import { isIPv6 } from "node:net";
import { afterAll, afterEach, beforeAll } from "vitest";
import { isLoopbackHost, mayPassThrough, server } from "./mock-server";

/**
 * The host name an `http.request()` or `http.get()` call connects to, in the
 * form `URL.hostname` gives it. As in Node, the options are merged over the
 * URL's, then `hostname` wins over `host`, and `localhost` is the default.
 */
function requestHostname(args: unknown[]): string {
  const [first, second] = args;
  const url = typeof first === "string" || first instanceof URL ? new URL(first) : undefined;
  const options = url === undefined ? first : second;
  const { hostname, host } = {
    ...(url && { hostname: url.hostname }),
    ...(typeof options === "object" && options !== null ? options : {}),
  } as http.RequestOptions;
  const name = hostname || host || "localhost";
  return isIPv6(name) ? `[${name}]` : name;
}

/**
 * Wraps a request function MSW patched so that a request to loopback calls the
 * unpatched function instead.
 */
function bypassForLoopback<T extends (...args: never[]) => unknown>(
  unpatched: T,
  patched: T,
): T {
  return new Proxy(patched, {
    apply: (target, thisArg, args) =>
      Reflect.apply(isLoopbackHost(requestHostname(args)) ? unpatched : target, thisArg, args),
  });
}

// Start mock server before all tests
beforeAll(() => {
  // Requests to the servers a test starts on loopback skip MSW. On passthrough,
  // @mswjs/interceptors 0.41 expects the request's agent to return its socket
  // at once, but Playwright's request API connects to a host name such as
  // `localhost` later and returns nothing: the request then hangs until it
  // times out. No handler mocks loopback, so MSW has nothing to do there.
  const unpatched = [http, https].map((module) => ({
    module,
    request: module.request,
    get: module.get,
  }));

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

  // `server.close()` puts the unpatched functions back.
  for (const { module, request, get } of unpatched) {
    Object.assign(module, {
      request: bypassForLoopback(request, module.request),
      get: bypassForLoopback(get, module.get),
    });
  }
});

// Reset handlers after each test to ensure test isolation
afterEach(() => {
  server.resetHandlers();
});

// Clean up after all tests
afterAll(() => {
  server.close();
});
