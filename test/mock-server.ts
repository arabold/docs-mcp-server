/**
 * Mock server for e2e tests.
 * 
 * This server intercepts HTTP requests during tests and returns predefined responses
 * from the fixtures directory. This makes tests fast, reliable, and independent of
 * external services.
 */

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixturesDir = join(__dirname, "fixtures");

// Helper to read fixture files
function readFixture(filename: string): string {
  return readFileSync(join(fixturesDir, filename), "utf-8");
}

// Define mock handlers for httpbin.org endpoints
export const handlers = [
  // OpenAI embeddings mock - returns a zero vector to satisfy embedding calls in tests
  http.post("https://api.openai.com/v1/embeddings", async ({ request }) => {
    // OpenAI accepts `input` as either a string or string[]
    const body = (await request.json()) as { input?: string | string[]; model?: string };

    const inputs = Array.isArray(body?.input)
      ? body.input
      : typeof body?.input === "string"
        ? [body.input]
        : [];

    const vector = Array(1536).fill(0);

    return HttpResponse.json({
      data: inputs.map((_, index) => ({
        object: "embedding",
        embedding: vector,
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

  // 404 endpoint
  http.get("https://httpbin.org/status/404", () => {
    return new HttpResponse("Not Found", {
      status: 404,
    });
  }),
];

// Create and export the mock server
export const server = setupServer(...handlers);
