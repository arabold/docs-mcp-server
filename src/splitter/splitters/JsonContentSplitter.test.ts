import { describe, expect, it } from "vitest";
import { JsonContentSplitter } from "./JsonContentSplitter";

describe("JsonContentSplitter", () => {
  const chunkSize = 50;
  const splitter = new JsonContentSplitter({ chunkSize });

  it("splits large arrays into valid JSON chunks", async () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const json = JSON.stringify(arr);
    const chunks = await splitter.split(json);
    for (const chunk of chunks) {
      expect(JSON.parse(chunk)).toBeDefined();
      expect(chunk.length).toBeLessThanOrEqual(chunkSize);
    }
    expect(chunks.join("")).toContain("0");
  });

  it("splits large objects into valid JSON chunks", async () => {
    const obj = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const json = JSON.stringify(obj);
    const chunks = await splitter.split(json);
    for (const chunk of chunks) {
      expect(JSON.parse(chunk)).toBeDefined();
      expect(chunk.length).toBeLessThanOrEqual(chunkSize);
    }
    expect(chunks.join("")).toContain("k0");
  });

  it("handles nested structures recursively", async () => {
    const obj = { a: Array(10).fill({ b: Array(10).fill(1) }) };
    const json = JSON.stringify(obj);
    const chunks = await splitter.split(json);
    for (const chunk of chunks) {
      expect(JSON.parse(chunk)).toBeDefined();
      expect(chunk.length).toBeLessThanOrEqual(chunkSize);
    }
  });

  it("returns single chunk for small JSON", async () => {
    const json = JSON.stringify({ a: 1 });
    const chunks = await splitter.split(json);
    expect(chunks.length).toBe(1);
    expect(JSON.parse(chunks[0])).toEqual({ a: 1 });
  });

  it("returns input as single chunk for invalid JSON", async () => {
    const input = "not a json";
    const chunks = await splitter.split(input);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(input);
  });
});
