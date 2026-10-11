/**
 * Mock server for e2e tests.
 * 
 * This server intercepts HTTP requests during tests and returns predefined responses
 * from the fixtures directory. This makes tests fast, reliable, and independent of
 * external services.
 */

import { HttpResponse, http, passthrough } from "msw";
import { setupServer } from "msw/node";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturesDir = join(__dirname, "fixtures");

// Helper to read fixture files
function readFixture(filename: string): string {
  return readFileSync(join(fixturesDir, filename), "utf-8");
}

/** Output dimension of text-embedding-3-small, the model the vector suites use. */
const EMBEDDING_DIMENSION = 1536;

/** 32-bit FNV-1a hash of a string. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Embeds text as a normalized bag of hashed character trigrams.
 *
 * The vector is deterministic and never all zeros. Texts that share words, or
 * parts of words, get closer vectors, so search ranking by similarity means
 * something: a misspelled word still lands near its correct spelling, which
 * full-text search does not match.
 */
function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const marked = `^${word}$`;
    for (let i = 0; i + 3 <= marked.length; i++) {
      vector[fnv1a(marked.slice(i, i + 3)) % EMBEDDING_DIMENSION] += 1;
    }
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

export const handlers = [
  // OpenAI embeddings: deterministic, similarity-preserving vectors (see embedText)
  http.post("https://api.openai.com/v1/embeddings", async ({ request }) => {
    // OpenAI accepts `input` as either a string or string[]
    const body = (await request.json()) as { input?: string | string[]; model?: string };

    const inputs = Array.isArray(body?.input)
      ? body.input
      : typeof body?.input === "string"
        ? [body.input]
        : [];

    return HttpResponse.json({
      data: inputs.map((input, index) => ({
        object: "embedding",
        embedding: embedText(input),
        index,
      })),
      model: body?.model ?? "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
  }),

  // HTML endpoint - returns Moby Dick content
  http.get("https://httpbin.org/html", () => {
    return new HttpResponse(readFixture("html.html"), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }),

  // JSON endpoint
  http.get("https://httpbin.org/json", () => {
    return new HttpResponse(readFixture("json.json"), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }),

  // XML endpoint
  http.get("https://httpbin.org/xml", () => {
    return new HttpResponse(readFixture("xml.xml"), {
      status: 200,
      headers: {
        "Content-Type": "application/xml",
      },
    });
  }),

  // robots.txt endpoint
  http.get("https://httpbin.org/robots.txt", () => {
    return new HttpResponse(readFixture("robots.txt"), {
      status: 200,
      headers: {
        "Content-Type": "text/plain",
      },
    });
  }),

  // Headers endpoint - echoes back the request headers
  http.get("https://httpbin.org/headers", ({ request }) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const response = {
      headers,
    };

    return HttpResponse.json(response, {
      status: 200,
    });
  }),

  // Redirect endpoint - simulates a redirect
  http.get("https://httpbin.org/redirect/1", () => {
    return new HttpResponse(null, {
      status: 302,
      headers: {
        Location: "https://httpbin.org/html",
      },
    });
  }),

  // Non-existent domain simulation
  http.get("https://this-domain-definitely-does-not-exist-12345.com", () => {
    return HttpResponse.error();
  }),

  // 404 endpoint
  http.get("https://httpbin.org/status/404", () => {
    return new HttpResponse("Not Found", {
      status: 404,
    });
  }),
];

/** How many opt-in live suites currently let requests through to the network. */
let liveSuites = 0;

/**
 * Lets every request through to the real network until the returned function
 * runs. Only for opt-in live suites: they call it in `beforeAll` once their
 * credentials are known to be set, and call the result in `afterAll`.
 *
 * @returns A function that withdraws the permission; calling it again does nothing.
 */
export function allowLiveNetwork(): () => void {
  liveSuites++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      liveSuites--;
    }
  };
}

/**
 * Whether a request may go through unmocked: to a server a test started on
 * loopback, or anywhere while an opt-in live suite runs.
 *
 * @param hostname The request's host name, as `URL.hostname` gives it.
 * @returns True when the request should go through unmocked.
 */
export function mayPassThrough(hostname: string): boolean {
  return (
    liveSuites > 0 ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

/**
 * Answers every request that no handler above, and no handler a test adds with
 * `server.use(...)`, claims. Anything outside `mayPassThrough` fails at once as a
 * network error rather than reaching the real network.
 */
const unmockedRequestHandler = http.all("*", ({ request }) => {
  if (mayPassThrough(new URL(request.url).hostname)) {
    return passthrough();
  }
  console.error(`Unmocked request in a test: ${request.method} ${request.url}`);
  return HttpResponse.error();
});

// Create and export the mock server
export const server = setupServer(...handlers, unmockedRequestHandler);
