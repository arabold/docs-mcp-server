/**
 * Client for the merged application API (`AppRouter`) served at `/api`.
 *
 * The web UI and every Node process that talks to a remote worker build their
 * client from the same links, so URL handling, the transformer and the
 * WebSocket used for `events.subscribe` live in one place. The module runs in
 * the browser too: it imports only `@trpc/client`, `superjson` and the router
 * type (enforced by a Biome rule in `biome.json`).
 */

import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  type TRPCClient,
  type TRPCLink,
  wsLink,
} from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "./appRouter";

/** Typed client for every procedure of the merged application API. */
export type ApiClient = TRPCClient<AppRouter>;

/** Links for the application API and a way to close their WebSocket. */
export interface ApiLinks {
  links: TRPCLink<AppRouter>[];
  /** Closes the WebSocket, if the links opened one. */
  close(): void;
}

/**
 * The WebSocket URL for an HTTP(S) endpoint: the same URL, path and query
 * included, with `http:`/`https:` replaced by `ws:`/`wss:`. Keeping the path
 * lets the connection pass a reverse proxy that serves the endpoint under a
 * prefix, such as `https://example.com/docs/api`.
 *
 * @param httpUrl An absolute `http:` or `https:` URL
 * @returns The matching `ws:` or `wss:` URL
 */
export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

/**
 * Builds the links for the application API at `apiUrl`. Queries and
 * mutations go over a batching HTTP link. With `subscriptions`, a WebSocket
 * with keep-alive carries subscriptions, so a half-open connection is noticed;
 * without, no WebSocket is opened.
 *
 * @param apiUrl The API's URL, e.g. `http://localhost:8080/api`.
 * @param options.subscriptions Whether the client will subscribe to events.
 * @returns The links and a function that closes their WebSocket.
 */
export function createApiLinks(
  apiUrl: string,
  options: { subscriptions: boolean },
): ApiLinks {
  const url = apiUrl.replace(/\/$/, "");
  const httpLink = httpBatchLink({ url, transformer: superjson });
  if (!options.subscriptions) {
    return { links: [httpLink], close: () => {} };
  }

  const wsClient = createWSClient({
    url: toWebSocketUrl(url),
    keepAlive: { enabled: true },
  });
  return {
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: wsLink({ client: wsClient, transformer: superjson }),
        false: httpLink,
      }),
    ],
    close: () => wsClient.close(),
  };
}

/**
 * Creates a typed client for the application API at `apiUrl`.
 *
 * @param apiUrl The API's URL, e.g. `http://localhost:8080/api`.
 * @param options.subscriptions Whether the client will subscribe to events.
 * @returns The client and a function that closes its WebSocket.
 */
export function createApiClient(
  apiUrl: string,
  options: { subscriptions: boolean },
): { api: ApiClient; close(): void } {
  const { links, close } = createApiLinks(apiUrl, options);
  return { api: createTRPCClient<AppRouter>({ links }), close };
}

/**
 * Checks that the application API at `apiUrl` answers.
 *
 * @param api A client for the API.
 * @param apiUrl The URL the client was created for, named in the error.
 * @throws Error with a hint about the expected URL when the API does not answer.
 */
export async function pingApi(api: ApiClient, apiUrl: string): Promise<void> {
  try {
    await api.ping.query();
  } catch {
    throw new Error(
      `Failed to connect to server at ${apiUrl.replace(/\/$/, "")}.\n\nPlease verify the server URL includes the correct port (default 8080) and ends with '/api' (e.g., 'http://localhost:8080/api').`,
    );
  }
}
