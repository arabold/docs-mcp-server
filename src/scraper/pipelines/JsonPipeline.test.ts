import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus } from "../fetcher/types";
import { JsonPipeline } from "./JsonPipeline";

describe("JsonPipeline", () => {
  const pipeline = new JsonPipeline(loadConfig());
  const baseOptions = {
    url: "test.json",
    library: "test-lib",
    version: "1.0.0",
    maxPages: 10,
    maxDepth: 3,
    includePatterns: [],
    excludePatterns: [],
  };

  it("should keep the JSON text and take the title from a name or title property", async () => {
    const cases: Array<{
      label: string;
      content: string | Buffer;
      text: string;
      title: string | undefined;
    }> = [
      {
        label: "object with a name",
        content: JSON.stringify({ name: "John", age: 30 }, null, 2),
        text: JSON.stringify({ name: "John", age: 30 }, null, 2),
        title: "John",
      },
      {
        label: "object with a title",
        content: JSON.stringify({
          title: "My API Documentation",
          version: "1.0.0",
          description: "REST API for user management",
        }),
        text: JSON.stringify({
          title: "My API Documentation",
          version: "1.0.0",
          description: "REST API for user management",
        }),
        title: "My API Documentation",
      },
      { label: "array", content: "[1, 2, 3]", text: "[1, 2, 3]", title: undefined },
      {
        label: "invalid JSON",
        content: "{ invalid json content",
        text: "{ invalid json content",
        title: undefined,
      },
      {
        label: "primitive",
        content: '"hello world"',
        text: '"hello world"',
        title: undefined,
      },
      { label: "empty object", content: "{}", text: "{}", title: undefined },
      {
        label: "Buffer",
        content: Buffer.from('{"test":"value"}', "utf-8"),
        text: '{"test":"value"}',
        title: undefined,
      },
    ];

    for (const { label, content, text, title } of cases) {
      const result = await pipeline.process(
        {
          content,
          mimeType: "application/json",
          charset: "utf-8",
          source: "data.json",
          status: FetchStatus.SUCCESS,
        },
        baseOptions,
      );

      expect.soft(result.textContent, label).toBe(text);
      expect.soft(result.title, label).toBe(title);
      expect.soft(result.links, label).toEqual([]);
      expect.soft(result.errors, label).toEqual([]);
    }
  });
});
