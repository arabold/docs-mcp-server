import { describe, expect, it } from "vitest";
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
      const greedySplitter = new GreedySplitter(jsonSplitter, 500, 1500);

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
});
