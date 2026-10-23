import { describe, expect, it } from "vitest";
import { defaults } from "../utils/config";
import { GreedySplitter } from "./GreedySplitter";
import { JsonDocumentSplitter } from "./JsonDocumentSplitter";
import type { Chunk, SplitterConfig } from "./types";

describe("JsonDocumentSplitter", () => {
  const mockConfig: SplitterConfig = {
    minChunkSize: defaults.splitter.minChunkSize,
    preferredChunkSize: defaults.splitter.preferredChunkSize,
    maxChunkSize: defaults.splitter.maxChunkSize,
    json: {
      maxNestingDepth: defaults.splitter.json.maxNestingDepth,
      maxChunks: defaults.splitter.json.maxChunks,
    },
  };
  const splitter = new JsonDocumentSplitter(mockConfig);

  /** Each chunk as `[content, path]`, with a check that every level equals its path length. */
  const shape = (chunks: Chunk[]) => {
    for (const chunk of chunks) {
      expect(chunk.section.level).toBe(chunk.section.path.length);
    }
    return chunks.map((c) => [c.content, c.section.path]);
  };

  describe("concatenation-friendly chunking", () => {
    it("creates building-block chunks that concatenate to valid JSON", async () => {
      const content = '{"first": "value1", "second": "value2", "third": "value3"}';
      const chunks = await splitter.splitText(content);

      expect(JSON.parse(chunks.map((c) => c.content).join("\n"))).toEqual(
        JSON.parse(content),
      );
      // Braces get their own chunks; every property but the last ends with a comma.
      expect(chunks.map((c) => c.content)).toEqual([
        "{",
        '  "first": "value1",',
        '  "second": "value2",',
        '  "third": "value3"',
        "}",
      ]);
    });
  });

  describe("nested structure handling", () => {
    it("indents nested objects and gives each property its full path", async () => {
      const content =
        '{"config": {"debug": true, "port": 8080, "db": {"host": "localhost"}}}';
      const chunks = await splitter.splitText(content);

      expect(JSON.parse(chunks.map((c) => c.content).join("\n"))).toEqual(
        JSON.parse(content),
      );
      expect(shape(chunks)).toEqual([
        ["{", ["root"]],
        ['  "config": ', ["root", "config"]],
        ["  {", ["root", "config"]],
        ['    "debug": true,', ["root", "config", "debug"]],
        ['    "port": 8080,', ["root", "config", "port"]],
        ['    "db": ', ["root", "config", "db"]],
        ["    {", ["root", "config", "db"]],
        ['      "host": "localhost"', ["root", "config", "db", "host"]],
        ["    }", ["root", "config", "db"]],
        ["  }", ["root", "config"]],
        ["}", ["root"]],
      ]);
    });

    it("gives array items an index path segment", async () => {
      const content =
        '{"items": [1, 2, 3], "users": [{"name": "Alice", "age": 30}, {"name": "Bob"}]}';
      const chunks = await splitter.splitText(content);

      expect(JSON.parse(chunks.map((c) => c.content).join("\n"))).toEqual(
        JSON.parse(content),
      );
      expect(shape(chunks)).toEqual([
        ["{", ["root"]],
        ['  "items": ', ["root", "items"]],
        ["  [", ["root", "items"]],
        ["    1,", ["root", "items", "[0]"]],
        ["    2,", ["root", "items", "[1]"]],
        ["    3", ["root", "items", "[2]"]],
        ["  ],", ["root", "items"]],
        ['  "users": ', ["root", "users"]],
        ["  [", ["root", "users"]],
        ["    {", ["root", "users", "[0]"]],
        ['      "name": "Alice",', ["root", "users", "[0]", "name"]],
        ['      "age": 30', ["root", "users", "[0]", "age"]],
        ["    },", ["root", "users", "[0]"]],
        ["    {", ["root", "users", "[1]"]],
        ['      "name": "Bob"', ["root", "users", "[1]", "name"]],
        ["    }", ["root", "users", "[1]"]],
        ["  ]", ["root", "users"]],
        ["}", ["root"]],
      ]);
    });
  });

  describe("edge cases", () => {
    it("should handle invalid JSON gracefully", async () => {
      const content = '{"invalid": json}';
      const chunks = await splitter.splitText(content);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].section.path).toEqual(["invalid-json"]);
      expect(chunks[0].content).toBe(content);
    });

    it("round-trips empty containers and null values", async () => {
      const cases: Array<[label: string, content: string]> = [
        ["empty object", "{}"],
        ["empty array", "[]"],
        ["null value", '{"nullable": null}'],
      ];

      for (const [label, content] of cases) {
        const chunks = await splitter.splitText(content);
        expect.soft(chunks.length, `${label}: chunks`).toBeGreaterThan(0);
        expect
          .soft(JSON.parse(chunks.map((c) => c.content).join("\n")), label)
          .toEqual(JSON.parse(content));
      }
    });
  });

  describe("indentation preservation", () => {
    it("should respect preserveFormatting option", async () => {
      const splitterNoFormat = new JsonDocumentSplitter(mockConfig, {
        preserveFormatting: false,
      });
      const content = '{"test": "value"}';
      const chunks = await splitterNoFormat.splitText(content);

      // With formatting disabled, should have minimal whitespace
      const hasIndentation = chunks.some((c) => c.content.startsWith("  "));
      expect(hasIndentation).toBe(false);
    });
  });

  describe("integration with GreedySplitter", () => {
    it("should create chunks that work well with GreedySplitter optimization", async () => {
      const jsonSplitter = new JsonDocumentSplitter(mockConfig);
      const greedySplitter = new GreedySplitter(jsonSplitter, 500, 1500, 5000);

      const complexJson = {
        application: {
          name: "Complex Application Configuration",
          version: "2.1.0",
          services: {
            database: {
              primary: {
                host: "primary-db.example.com",
                port: 5432,
                ssl: true,
                poolSize: 20,
              },
              replica: {
                host: "replica-db.example.com",
                port: 5432,
                ssl: true,
                poolSize: 10,
              },
            },
            cache: {
              redis: {
                host: "cache.example.com",
                port: 6379,
                database: 0,
              },
            },
          },
          features: {
            authentication: true,
            authorization: true,
            monitoring: true,
            logging: {
              level: "info",
              format: "json",
            },
          },
        },
      };

      const content = JSON.stringify(complexJson, null, 2);

      // Test JsonDocumentSplitter alone
      const jsonChunks = await jsonSplitter.splitText(content);
      expect(jsonChunks.length).toBeGreaterThan(5); // Should create many small chunks

      // Test GreedySplitter optimization
      const optimizedChunks = await greedySplitter.splitText(content);
      expect(optimizedChunks.length).toBeLessThanOrEqual(jsonChunks.length); // Should consolidate

      // Verify concatenation still produces valid JSON
      const concatenated = optimizedChunks.map((c) => c.content).join("\n");
      const parsed = JSON.parse(concatenated);
      expect(parsed).toEqual(complexJson);

      // Verify chunks are reasonably sized
      optimizedChunks.forEach((chunk) => {
        expect(chunk.content.length).toBeGreaterThan(0);
      });
    });
  });

  describe("chunk size limits", () => {
    it("keeps every chunk within maxChunkSize for oversized values", async () => {
      const nest = (depth: number, leaf: Record<string, unknown>) => {
        let value: Record<string, unknown> = leaf;
        for (let i = depth; i >= 1; i--) value = { [`level${i}`]: value };
        return value;
      };
      const cases: Array<
        [label: string, json: unknown, maxDepth: number | undefined, minChunks: number]
      > = [
        [
          "large value deep in an object",
          nest(6, { largeData: "x".repeat(6000) }),
          undefined,
          1,
        ],
        [
          "very large value past maxDepth",
          nest(6, { hugeData: "y".repeat(15000), moreData: "additional data" }),
          3,
          2,
        ],
        [
          "array of large values past maxDepth",
          nest(3, { level4: ["z".repeat(6000), "z".repeat(6000), "z".repeat(6000)] }),
          3,
          1,
        ],
        [
          "oversized primitive property before maxDepth",
          { level1: { largeProp: "x".repeat(6000), smallProp: "ok" } },
          3,
          5,
        ],
        [
          "oversized primitive array item before maxDepth",
          { level1: { items: ["y".repeat(6000), "small"] } },
          3,
          6,
        ],
      ];

      for (const [label, json, maxDepth, minChunks] of cases) {
        const limited = new JsonDocumentSplitter(mockConfig, { maxDepth });
        const chunks = await limited.splitText(JSON.stringify(json, null, 2));
        expect.soft(chunks.length, `${label}: chunks`).toBeGreaterThanOrEqual(minChunks);
        for (const chunk of chunks) {
          expect
            .soft(chunk.content.length, `${label}: chunk size`)
            .toBeLessThanOrEqual(defaults.splitter.maxChunkSize);
        }
      }
    });
  });

  describe("depth limiting", () => {
    it("stops chunking at maxDepth and serializes the rest as text", async () => {
      const cases: Array<[label: string, json: unknown, serialized: string[]]> = [
        [
          "object",
          {
            level1: {
              level2: {
                level3: {
                  level4: {
                    level5: {
                      level6: { deepValue: "this should be serialized as text" },
                    },
                  },
                },
              },
            },
          },
          ["level4", "level5", "level6", "deepValue"],
        ],
        [
          "array",
          {
            level1: [{ level2: [{ level3: [{ level4: [{ level5: "deep value" }] }] }] }],
          },
          ["level4", "level5"],
        ],
      ];

      for (const [label, json, serialized] of cases) {
        const limited = new JsonDocumentSplitter(mockConfig, { maxDepth: 3 });
        const chunks = await limited.splitText(JSON.stringify(json, null, 2));

        // Paths stop near maxDepth, allowing for the structure chunks around a value.
        const maxPathDepth = Math.max(...chunks.map((c) => c.section.path.length));
        expect.soft(maxPathDepth, `${label}: path depth`).toBeLessThanOrEqual(5);
        expect
          .soft(
            chunks.some((c) => serialized.every((key) => c.content.includes(key))),
            `${label}: one chunk holds the serialized rest`,
          )
          .toBe(true);
        expect
          .soft(
            JSON.parse(chunks.map((c) => c.content).join("\n")),
            `${label}: round trip`,
          )
          .toEqual(json);
      }
    });

    it("should use default maxDepth when not specified", async () => {
      // Create JSON with depth exceeding the default
      let deepJson: Record<string, unknown> = { value: "leaf" };
      for (let i = 0; i < defaults.splitter.json.maxNestingDepth + 3; i++) {
        deepJson = { [`level${i}`]: deepJson };
      }

      const splitter = new JsonDocumentSplitter(mockConfig);
      const chunks = await splitter.splitText(JSON.stringify(deepJson, null, 2));

      // Should have chunks but not excessive amounts
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.length).toBeLessThan(100); // Reasonable upper bound

      // Verify concatenation produces valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      const parsed = JSON.parse(concatenated);
      expect(parsed).toEqual(deepJson);
    });

    it("should not serialize primitives and shallow structures as text", async () => {
      const shallowJson = {
        level1: {
          level2: {
            value: "normal value",
            number: 42,
            bool: true,
          },
        },
      };

      const splitter = new JsonDocumentSplitter(mockConfig, { maxDepth: 5 });
      const chunks = await splitter.splitText(JSON.stringify(shallowJson, null, 2));

      // All value chunks should be individual, not serialized together
      const valueChunk = chunks.find((c) =>
        c.content.includes('"value": "normal value"'),
      );
      expect(valueChunk).toBeDefined();
      expect(valueChunk?.content).not.toContain("number");
      expect(valueChunk?.content).not.toContain("bool");

      // Every chunk stays small and keeps its place in the structure.
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThan(200);
        expect(chunk.section.level).toBeGreaterThan(0);
      }
    });
  });

  describe("chunk count limiting", () => {
    it("should fall back to text splitting when maxChunks is exceeded", async () => {
      // Create a JSON with many properties that will exceed the limit
      const largeJson: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        largeJson[`property${i}`] = {
          subProperty1: `value${i}a`,
          subProperty2: `value${i}b`,
          subProperty3: `value${i}c`,
        };
      }

      const splitter = new JsonDocumentSplitter(mockConfig, { maxChunks: 50 });
      const chunks = await splitter.splitText(JSON.stringify(largeJson, null, 2));

      // Should fall back to text splitting, resulting in fewer chunks
      expect(chunks.length).toBeLessThanOrEqual(100); // Much less than the ~600+ it would create

      // Verify the chunks don't have the fine-grained JSON structure
      // Text splitter uses level 0 and empty path
      const hasTextSplitterChunks = chunks.some(
        (c) => c.section.level === 0 && c.section.path.length === 0,
      );
      expect(hasTextSplitterChunks).toBe(true);

      // The text fallback still respects the size limit.
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeLessThanOrEqual(defaults.splitter.maxChunkSize);
      }
    });

    it("keeps JSON chunking when the chunk count stays under maxChunks", async () => {
      const flat = (count: number) =>
        Object.fromEntries(
          Array.from({ length: count }, (_, i) => [`prop${i}`, `value${i}`]),
        );
      const cases: Array<[label: string, maxChunks: number | undefined, json: unknown]> =
        [
          ["explicit maxChunks", 100, flat(10)],
          ["default maxChunks", undefined, flat(50)],
        ];

      for (const [label, maxChunks, json] of cases) {
        const limited = new JsonDocumentSplitter(mockConfig, { maxChunks });
        const chunks = await limited.splitText(JSON.stringify(json, null, 2));

        expect
          .soft(chunks.length, `${label}: chunk count`)
          .toBeLessThanOrEqual(maxChunks ?? defaults.splitter.json.maxChunks);
        expect
          .soft(
            chunks.every((c) => c.section.path[0] === "root"),
            `${label}: JSON paths`,
          )
          .toBe(true);
        expect
          .soft(
            JSON.parse(chunks.map((c) => c.content).join("\n")),
            `${label}: round trip`,
          )
          .toEqual(json);
      }
    });
  });

  describe("combined depth and chunk limiting", () => {
    it("should handle both depth and chunk limits together", async () => {
      // Create JSON that is both deep and wide
      const complexJson: Record<string, unknown> = {};
      for (let i = 0; i < 20; i++) {
        complexJson[`branch${i}`] = {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    deepValue: `value${i}`,
                  },
                },
              },
            },
          },
        };
      }

      const splitter = new JsonDocumentSplitter(mockConfig, {
        maxDepth: 3,
        maxChunks: 200,
      });
      const chunks = await splitter.splitText(JSON.stringify(complexJson, null, 2));

      // Should limit depth to prevent excessive nesting
      const pathDepths = chunks.map((c) => c.section.path.length);
      const maxPathDepth = Math.max(...pathDepths);
      expect(maxPathDepth).toBeLessThanOrEqual(6); // Some buffer for structure

      // Should have reasonable chunk count (may fall back to text splitting)
      expect(chunks.length).toBeLessThanOrEqual(250);

      // Verify concatenation produces valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      const parsed = JSON.parse(concatenated);
      expect(parsed).toEqual(complexJson);
    });
  });
});
