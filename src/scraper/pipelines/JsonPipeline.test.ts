import { describe, expect, it } from "vitest";
import type { RawContent } from "../fetcher/types";
import { JsonPipeline } from "./JsonPipeline";

// Helper: pretty-print JSON for easier assertions
function pretty(json: unknown) {
  return JSON.stringify(json, null, 2);
}

// Minimal valid ScraperOptions for tests
const dummyOptions = {
  url: "test.json",
  library: "test",
  version: "1.0",
};
// Dummy ContentFetcher implementation
const dummyFetcher = {
  canFetch: () => false,
  fetch: async () => Promise.reject(new Error("Not implemented")),
};

describe("JsonPipeline", () => {
  it("canProcess returns true for JSON MIME types", () => {
    const pipeline = new JsonPipeline();
    const validTypes = [
      "application/json",
      "application/ld+json",
      "application/vnd.api+json",
      "text/json",
      "application/json5",
    ];
    for (const mimeType of validTypes) {
      expect(pipeline.canProcess({ mimeType } as RawContent)).toBe(true);
    }
  });

  it("canProcess returns false for non-JSON MIME types", () => {
    const pipeline = new JsonPipeline();
    const invalidTypes = [
      "text/html",
      "text/plain",
      "application/xml",
      "text/markdown",
      "image/png",
    ];
    for (const mimeType of invalidTypes) {
      expect(pipeline.canProcess({ mimeType } as RawContent)).toBe(false);
    }
  });

  it("splits large JSON arrays into valid JSON chunks", async () => {
    const pipeline = new JsonPipeline();
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: i, value: `item${i}` }));
    const raw: RawContent = {
      content: pretty(arr),
      mimeType: "application/json",
      source: "test.json",
    };
    const result = await pipeline.process(raw, dummyOptions, dummyFetcher);
    // Should produce multiple chunks, each valid JSON
    const chunks = result.textContent.split("\n");
    for (const chunk of chunks) {
      expect(() => JSON.parse(chunk)).not.toThrow();
    }
    // Should cover all items
    const allItems = chunks.flatMap((chunk) => JSON.parse(chunk));
    expect(allItems.length).toBe(100);
  });

  it("splits large JSON objects into valid JSON chunks", async () => {
    const pipeline = new JsonPipeline();
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) obj[`key${i}`] = { id: i, value: `item${i}` };
    const raw: RawContent = {
      content: pretty(obj),
      mimeType: "application/json",
      source: "test.json",
    };
    const result = await pipeline.process(raw, dummyOptions, dummyFetcher);
    const chunks = result.textContent.split("\n");
    for (const chunk of chunks) {
      expect(() => JSON.parse(chunk)).not.toThrow();
    }
    // Should cover all keys
    const allKeys = chunks.flatMap((chunk) => Object.keys(JSON.parse(chunk)));
    expect(new Set(allKeys).size).toBe(100);
  });

  it("handles small JSON files as a single chunk", async () => {
    const pipeline = new JsonPipeline();
    const data = { foo: 1, bar: [1, 2, 3] };
    const raw: RawContent = {
      content: pretty(data),
      mimeType: "application/json",
      source: "test.json",
    };
    const result = await pipeline.process(raw, dummyOptions, dummyFetcher);
    // Should be a single chunk
    expect(result.textContent.split("\n").length).toBe(1);
    expect(() => JSON.parse(result.textContent)).not.toThrow();
  });

  it("returns metadata with the source as title", async () => {
    const pipeline = new JsonPipeline();
    const data = { foo: "bar" };
    const raw: RawContent = {
      content: pretty(data),
      mimeType: "application/json",
      source: "test.json",
    };
    const result = await pipeline.process(raw, dummyOptions, dummyFetcher);
    expect(result.metadata.title).toBe("test.json");
  });
});
