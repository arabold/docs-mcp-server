/**
 * Shared setup for the E2E suites that mock HTTP with nock.
 *
 * nock 14 and the global MSW server (`setup-e2e.ts`) are both built on
 * `@mswjs/interceptors`, and they share one interceptor instance: whichever
 * applies first owns it, and the other adds its listener to it. Every request
 * therefore reaches both, one after the other. nock applies when it is imported,
 * so it runs first and answers; MSW then sees a request it has no handler for and
 * warns about it, although nothing went to the network.
 *
 * A request nock has no interceptor for is the dangerous case. With net connect
 * allowed, nock steps aside, MSW's warn strategy passes the request through, and
 * it reaches the real network.
 */

import { http, passthrough } from "msw";
import nock from "nock";
import { server } from "./mock-server";

/** The only hosts nock may still connect to: loopback, with or without a port. */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Makes nock the sole responder for the given origins.
 *
 * nock refuses every request it has no interceptor for, so an unmocked request
 * fails inside the test rather than reaching the network. MSW gets a passthrough
 * handler for each origin, so it defers to nock whichever listener runs first,
 * and stops warning about requests nock already answered.
 *
 * Call it from `beforeEach`: `setup-e2e.ts` resets MSW handlers after every test.
 *
 * @param origins Origins the suite mocks with nock, e.g. `http://docs.example.com`.
 */
export function mockOriginsWithNock(...origins: string[]): void {
  nock.disableNetConnect();
  nock.enableNetConnect(LOOPBACK_HOST);
  server.use(...origins.map((origin) => http.all(`${origin}/*`, () => passthrough())));
}
