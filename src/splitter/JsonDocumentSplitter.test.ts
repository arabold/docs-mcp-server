import { describe, expect, it } from "vitest";
import { SPLITTER_MAX_CHUNK_SIZE } from "../utils/config";
import { JsonDocumentSplitter } from "./JsonDocumentSplitter";

describe("JsonDocumentSplitter", () => {
  const splitter = new JsonDocumentSplitter();

  describe("concatenation-friendly chunking", () => {
    it("should create building-block chunks that concatenate to valid JSON", async () => {
      const content = '{"name": "test", "version": "1.0.0"}';
      const chunks = await splitter.splitText(content);

      // Concatenate all chunks to verify they form valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();

      // Should have opening brace, two properties, closing brace
      expect(chunks.some((c) => c.content.trim() === "{")).toBe(true);
      expect(chunks.some((c) => c.content.includes('"name": "test"'))).toBe(true);
      expect(chunks.some((c) => c.content.includes('"version": "1.0.0"'))).toBe(true);
      expect(
        chunks.some((c) => c.content.trim() === "}" || c.content.trim() === "},"),
      ).toBe(true);
    });

    it("should handle comma placement correctly", async () => {
      const content = '{"first": "value1", "second": "value2", "third": "value3"}';
      const chunks = await splitter.splitText(content);

      // Find property chunks
      const properties = chunks.filter(
        (c) =>
          c.content.includes('"first"') ||
          c.content.includes('"second"') ||
          c.content.includes('"third"'),
      );

      // First two properties should have commas, last should not
      const firstProp = properties.find((c) => c.content.includes('"first"'));
      const thirdProp = properties.find((c) => c.content.includes('"third"'));

      expect(firstProp?.content).toContain(",");
      expect(thirdProp?.content).not.toContain(",");
    });
  });

  describe("nested structure handling", () => {
    it("should create concatenable chunks for nested objects", async () => {
      const content = '{"config": {"debug": true, "port": 8080}}';
      const chunks = await splitter.splitText(content);

      // Should be able to concatenate to valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();

      // Should have hierarchical structure with proper indentation
      expect(chunks.some((c) => c.content.includes('"config": '))).toBe(true);
      expect(chunks.some((c) => c.content.includes('  "debug": true'))).toBe(true);
      expect(chunks.some((c) => c.content.includes('  "port": 8080'))).toBe(true);

      // Verify level/path relationship for nested chunks
      const configChunk = chunks.find((c) => c.content.includes('"config":'));
      expect(configChunk).toBeDefined();
      expect(configChunk!.section.level).toBe(configChunk!.section.path.length);

      const debugChunk = chunks.find((c) => c.content.includes('"debug": true'));
      expect(debugChunk).toBeDefined();
      expect(debugChunk!.section.level).toBe(debugChunk!.section.path.length);
      expect(debugChunk!.section.level).toBeGreaterThan(configChunk!.section.level);
    });

    it("should handle nested arrays correctly", async () => {
      const content = '{"items": [1, 2, 3]}';
      const chunks = await splitter.splitText(content);

      // Should concatenate to valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();

      // Should have array structure
      expect(chunks.some((c) => c.content.includes('"items": '))).toBe(true);
      expect(chunks.some((c) => c.content.trim() === "[")).toBe(true);
      expect(chunks.some((c) => c.content.includes("1,"))).toBe(true);
      expect(
        chunks.some((c) => c.content.includes("3") && !c.content.includes("3,")),
      ).toBe(true); // Last item no comma
      expect(
        chunks.some((c) => c.content.trim() === "]" || c.content.trim() === "],"),
      ).toBe(true);

      // Verify level/path relationships
      chunks.forEach((chunk) => {
        expect(chunk.section.level).toBe(chunk.section.path.length);
      });

      // Test specific path structures for array items
      const itemsChunk = chunks.find((c) => c.content.includes('"items":'));
      expect(itemsChunk).toBeDefined();
      expect(itemsChunk!.section.path).toEqual(["root", "items"]);
      expect(itemsChunk!.section.level).toBe(2);

      // Find array item chunks by their content and verify exact paths
      const firstItemChunk = chunks.find((c) => c.content.includes("1,"));
      expect(firstItemChunk).toBeDefined();
      expect(firstItemChunk!.section.path).toEqual(["root", "items", "[0]"]);
      expect(firstItemChunk!.section.level).toBe(3);

      const secondItemChunk = chunks.find((c) => c.content.includes("2,"));
      expect(secondItemChunk).toBeDefined();
      expect(secondItemChunk!.section.path).toEqual(["root", "items", "[1]"]);
      expect(secondItemChunk!.section.level).toBe(3);

      const thirdItemChunk = chunks.find(
        (c) => c.content.includes("3") && !c.content.includes("3,"),
      );
      expect(thirdItemChunk).toBeDefined();
      expect(thirdItemChunk!.section.path).toEqual(["root", "items", "[2]"]);
      expect(thirdItemChunk!.section.level).toBe(3);
    });

    it("should handle complex arrays with nested objects correctly", async () => {
      const content = '{"users": [{"name": "Alice", "age": 30}, {"name": "Bob"}]}';
      const chunks = await splitter.splitText(content);

      // Should concatenate to valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();

      // Verify all chunks follow level === path.length rule
      chunks.forEach((chunk) => {
        expect(chunk.section.level).toBe(chunk.section.path.length);
      });

      // Test specific array index paths
      const aliceNameChunk = chunks.find((c) => c.content.includes('"name": "Alice"'));
      expect(aliceNameChunk).toBeDefined();
      expect(aliceNameChunk!.section.path).toEqual(["root", "users", "[0]", "name"]);
      expect(aliceNameChunk!.section.level).toBe(4);

      const aliceAgeChunk = chunks.find((c) => c.content.includes('"age": 30'));
      expect(aliceAgeChunk).toBeDefined();
      expect(aliceAgeChunk!.section.path).toEqual(["root", "users", "[0]", "age"]);
      expect(aliceAgeChunk!.section.level).toBe(4);

      const bobNameChunk = chunks.find((c) => c.content.includes('"name": "Bob"'));
      expect(bobNameChunk).toBeDefined();
      expect(bobNameChunk!.section.path).toEqual(["root", "users", "[1]", "name"]);
      expect(bobNameChunk!.section.level).toBe(4);
    });
  });

  describe("path and structure information", () => {
    it("should maintain hierarchical path information", async () => {
      const content = '{"a": {"b": {"c": "value"}}}';
      const chunks = await splitter.splitText(content);

      // Check for proper path hierarchy
      expect(chunks.some((chunk) => chunk.section.path.includes("a"))).toBe(true);
      expect(chunks.some((chunk) => chunk.section.path.includes("b"))).toBe(true);
      expect(chunks.some((chunk) => chunk.section.path.includes("c"))).toBe(true);

      // Verify level corresponds to path length
      chunks.forEach((chunk) => {
        expect(chunk.section.level).toBe(chunk.section.path.length);
      });

      // Find specific chunks and verify their levels
      const aChunk = chunks.find(
        (chunk) => chunk.section.path.includes("a") && chunk.content.includes('"a":'),
      );
      expect(aChunk).toBeDefined();
      expect(aChunk!.section.path).toEqual(["root", "a"]);
      expect(aChunk!.section.level).toBe(2);

      const cChunk = chunks.find(
        (chunk) =>
          chunk.section.path.includes("c") && chunk.content.includes('"c": "value"'),
      );
      expect(cChunk).toBeDefined();
      expect(cChunk!.section.path).toEqual(["root", "a", "b", "c"]);
      expect(cChunk!.section.level).toBe(4);
    });

    it("should provide appropriate level numbers", async () => {
      const content = '{"level1": {"level2": "value"}}';
      const chunks = await splitter.splitText(content);

      const level1Chunks = chunks.filter((chunk) =>
        chunk.section.path.includes("level1"),
      );
      const level2Chunks = chunks.filter((chunk) =>
        chunk.section.path.includes("level2"),
      );

      expect(level1Chunks.some((chunk) => chunk.section.level >= 2)).toBe(true);
      expect(level2Chunks.some((chunk) => chunk.section.level >= 3)).toBe(true);

      // Verify that level equals path length for all chunks
      [...level1Chunks, ...level2Chunks].forEach((chunk) => {
        expect(chunk.section.level).toBe(chunk.section.path.length);
      });
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

    it("should handle empty objects", async () => {
      const content = "{}";
      const chunks = await splitter.splitText(content);

      expect(chunks.length).toBeGreaterThan(0);
      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();
    });

    it("should handle empty arrays", async () => {
      const content = "[]";
      const chunks = await splitter.splitText(content);

      expect(chunks.length).toBeGreaterThan(0);
      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();
    });

    it("should handle null values correctly", async () => {
      const content = '{"nullable": null}';
      const chunks = await splitter.splitText(content);

      const concatenated = chunks.map((c) => c.content).join("\n");
      expect(() => JSON.parse(concatenated)).not.toThrow();
      expect(chunks.some((chunk) => chunk.content.includes("null"))).toBe(true);
    });
  });

  describe("indentation preservation", () => {
    it("should maintain proper indentation in nested structures", async () => {
      const content = '{"outer": {"inner": "value"}}';
      const chunks = await splitter.splitText(content);

      // Check for proper indentation levels
      expect(chunks.some((c) => c.content.includes('  "inner": "value"'))).toBe(true); // 2-space indent
    });

    it("should respect preserveFormatting option", async () => {
      const splitterNoFormat = new JsonDocumentSplitter({ preserveFormatting: false });
      const content = '{"test": "value"}';
      const chunks = await splitterNoFormat.splitText(content);

      // With formatting disabled, should have minimal whitespace
      const hasIndentation = chunks.some((c) => c.content.startsWith("  "));
      expect(hasIndentation).toBe(false);
    });
  });

  describe("integration with GreedySplitter", () => {
    it("should create chunks that work well with GreedySplitter optimization", async () => {
      const { GreedySplitter } = await import("./GreedySplitter");

      const jsonSplitter = new JsonDocumentSplitter();
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
    it("should respect max chunk size when processing deep nested JSON", async () => {
      const largeValue = "x".repeat(6000);
      const deepJson = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    largeData: largeValue,
                  },
                },
              },
            },
          },
        },
      };

      const chunks = await splitter.splitText(JSON.stringify(deepJson, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
      });
    });

    it("should respect max chunk size when exceeding maxChunks limit", async () => {
      const largeJson: Record<string, unknown> = {};
      for (let i = 0; i < 100; i++) {
        largeJson[`property${i}`] = "x".repeat(6000);
      }

      const limitedSplitter = new JsonDocumentSplitter({ maxChunks: 50 });
      const chunks = await limitedSplitter.splitText(JSON.stringify(largeJson, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
      });

      const hasTextSplitterChunks = chunks.some(
        (c) => c.section.level === 0 && c.section.path.length === 0,
      );
      expect(hasTextSplitterChunks).toBe(true);
    });

    it("should handle very large single JSON values at max depth", async () => {
      const veryLargeValue = "y".repeat(15000);
      const json = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    hugeData: veryLargeValue,
                    moreData: "additional data",
                  },
                },
              },
            },
          },
        },
      };

      const limitedSplitter = new JsonDocumentSplitter({ maxDepth: 3 });
      const chunks = await limitedSplitter.splitText(JSON.stringify(json, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
      });

      expect(chunks.length).toBeGreaterThan(1);
    });

    it("should handle array with large values at max depth", async () => {
      const largeValue = "z".repeat(6000);
      const json = {
        level1: {
          level2: {
            level3: {
              level4: [largeValue, largeValue, largeValue],
            },
          },
        },
      };

      const limitedSplitter = new JsonDocumentSplitter({ maxDepth: 3 });
      const chunks = await limitedSplitter.splitText(JSON.stringify(json, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
      });
    });

    it("should split oversized primitive properties before hitting max depth", async () => {
      const largeValue = "x".repeat(6000);
      const json = {
        level1: {
          largeProp: largeValue,
          smallProp: "ok",
        },
      };

      const limitedSplitter = new JsonDocumentSplitter({ maxDepth: 3 });
      const chunks = await limitedSplitter.splitText(JSON.stringify(json, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
      });

      expect(chunks.length).toBeGreaterThan(4);
    });

    it("should split oversized primitive array items before hitting max depth", async () => {
      const largeValue = "y".repeat(6000);
      const json = {
        level1: {
          items: [largeValue, "small"],
        },
      };

      const limitedSplitter = new JsonDocumentSplitter({ maxDepth: 3 });
      const chunks = await limitedSplitter.splitText(JSON.stringify(json, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThanOrEqual(SPLITTER_MAX_CHUNK_SIZE);
      });

      expect(chunks.length).toBeGreaterThan(5);
    });

    it("should keep small chunks well below the max when not at depth limit", async () => {
      const json = {
        config: {
          database: {
            host: "localhost",
            port: 5432,
            name: "mydb",
          },
          cache: {
            enabled: true,
            ttl: 3600,
          },
        },
      };

      const limitedSplitter = new JsonDocumentSplitter({ maxDepth: 5 });
      const chunks = await limitedSplitter.splitText(JSON.stringify(json, null, 2));

      chunks.forEach((chunk) => {
        expect(chunk.content.length).toBeLessThan(200);
      });

      const hasJsonStructure = chunks.some((c) => c.section.level > 0);
      expect(hasJsonStructure).toBe(true);
    });
  });

  describe("depth limiting", () => {
    it("should stop chunking at maxDepth and serialize remaining content as text", async () => {
      const deepJson = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    deepValue: "this should be serialized as text",
                  },
                },
              },
            },
          },
        },
      };

      const splitter = new JsonDocumentSplitter({ maxDepth: 3 });
      const chunks = await splitter.splitText(JSON.stringify(deepJson, null, 2));

      // Should have chunks for levels 1-3, then serialize the rest as text
      const pathDepths = chunks.map((c) => c.section.path.length);
      const maxPathDepth = Math.max(...pathDepths);

      // Max path depth should not exceed maxDepth + some buffer for structure chunks
      expect(maxPathDepth).toBeLessThanOrEqual(5);

      // Should find a chunk that contains the deeply nested content serialized as text
      const textSerializedChunk = chunks.find(
        (c) =>
          c.content.includes("level4") &&
          c.content.includes("level5") &&
          c.content.includes("level6") &&
          c.content.includes("deepValue"),
      );
      expect(textSerializedChunk).toBeDefined();

      // Verify concatenation still produces valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      const parsed = JSON.parse(concatenated);
      expect(parsed).toEqual(deepJson);
    });

    it("should handle depth limit with arrays", async () => {
      const deepArrayJson = {
        level1: [
          {
            level2: [
              {
                level3: [
                  {
                    level4: [
                      {
                        level5: "deep value",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const splitter = new JsonDocumentSplitter({ maxDepth: 3 });
      const chunks = await splitter.splitText(JSON.stringify(deepArrayJson, null, 2));

      // Verify that deep content is serialized
      const hasSerializedDeepContent = chunks.some(
        (c) => c.content.includes("level4") && c.content.includes("level5"),
      );
      expect(hasSerializedDeepContent).toBe(true);

      // Verify concatenation still produces valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      const parsed = JSON.parse(concatenated);
      expect(parsed).toEqual(deepArrayJson);
    });

    it("should use default maxDepth when not specified", async () => {
      const { JSON_MAX_NESTING_DEPTH } = await import("../utils/config");

      // Create JSON with depth exceeding the default
      let deepJson: any = { value: "leaf" };
      for (let i = 0; i < JSON_MAX_NESTING_DEPTH + 3; i++) {
        deepJson = { [`level${i}`]: deepJson };
      }

      const splitter = new JsonDocumentSplitter();
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

      const splitter = new JsonDocumentSplitter({ maxDepth: 5 });
      const chunks = await splitter.splitText(JSON.stringify(shallowJson, null, 2));

      // All value chunks should be individual, not serialized together
      const valueChunk = chunks.find((c) =>
        c.content.includes('"value": "normal value"'),
      );
      expect(valueChunk).toBeDefined();
      expect(valueChunk?.content).not.toContain("number");
      expect(valueChunk?.content).not.toContain("bool");
    });
  });

  describe("chunk count limiting", () => {
    it("should fall back to text splitting when maxChunks is exceeded", async () => {
      // Create a JSON with many properties that will exceed the limit
      const largeJson: Record<string, any> = {};
      for (let i = 0; i < 100; i++) {
        largeJson[`property${i}`] = {
          subProperty1: `value${i}a`,
          subProperty2: `value${i}b`,
          subProperty3: `value${i}c`,
        };
      }

      const splitter = new JsonDocumentSplitter({ maxChunks: 50 });
      const chunks = await splitter.splitText(JSON.stringify(largeJson, null, 2));

      // Should fall back to text splitting, resulting in fewer chunks
      expect(chunks.length).toBeLessThanOrEqual(100); // Much less than the ~600+ it would create

      // Verify the chunks don't have the fine-grained JSON structure
      // Text splitter uses level 0 and empty path
      const hasTextSplitterChunks = chunks.some(
        (c) => c.section.level === 0 && c.section.path.length === 0,
      );
      expect(hasTextSplitterChunks).toBe(true);
    });

    it("should not fall back when under maxChunks limit", async () => {
      const moderateJson: Record<string, any> = {};
      for (let i = 0; i < 10; i++) {
        moderateJson[`property${i}`] = `value${i}`;
      }

      const splitter = new JsonDocumentSplitter({ maxChunks: 100 });
      const chunks = await splitter.splitText(JSON.stringify(moderateJson, null, 2));

      // Should use JSON splitting (level > 0 and non-empty paths)
      const hasJsonSplitterChunks = chunks.every(
        (c) => c.section.level > 0 || c.section.path.length > 0,
      );
      expect(hasJsonSplitterChunks).toBe(true);

      // Verify concatenation produces valid JSON
      const concatenated = chunks.map((c) => c.content).join("\n");
      const parsed = JSON.parse(concatenated);
      expect(parsed).toEqual(moderateJson);
    });

    it("should use default maxChunks when not specified", async () => {
      const { JSON_MAX_CHUNKS } = await import("../utils/config");

      // Create a moderately sized JSON that won't exceed default limit
      const json: Record<string, string> = {};
      for (let i = 0; i < 50; i++) {
        json[`prop${i}`] = `value${i}`;
      }

      const splitter = new JsonDocumentSplitter();
      const chunks = await splitter.splitText(JSON.stringify(json, null, 2));

      // Should be well under the default limit
      expect(chunks.length).toBeLessThan(JSON_MAX_CHUNKS);

      // Should still use JSON splitting
      const hasJsonSplitterChunks = chunks.some((c) => c.section.path.includes("root"));
      expect(hasJsonSplitterChunks).toBe(true);
    });
  });

  describe("combined depth and chunk limiting", () => {
    it("should handle both depth and chunk limits together", async () => {
      // Create JSON that is both deep and wide
      const complexJson: Record<string, any> = {};
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

      const splitter = new JsonDocumentSplitter({ maxDepth: 3, maxChunks: 200 });
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
