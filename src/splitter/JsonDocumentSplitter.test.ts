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
});
