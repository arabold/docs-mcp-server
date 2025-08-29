import { describe, expect, it } from "vitest";
import type { RawContent } from "../fetcher/types";
import { JsonPipeline } from "./JsonPipeline";

describe("JsonPipeline", () => {
  const pipeline = new JsonPipeline();
  const baseOptions = {
    url: "test.json",
    library: "test-lib",
    version: "1.0.0",
    maxPages: 10,
    maxDepth: 3,
    includePatterns: [],
    excludePatterns: [],
  };

  describe("canProcess", () => {
    it("should accept JSON MIME types", () => {
      const jsonContent: RawContent = {
        content: "{}",
        mimeType: "application/json",
        charset: "utf-8",
        source: "test.json",
      };

      expect(pipeline.canProcess(jsonContent)).toBe(true);
    });

    it("should accept text/json MIME type", () => {
      const jsonContent: RawContent = {
        content: "{}",
        mimeType: "text/json",
        charset: "utf-8",
        source: "test.json",
      };

      expect(pipeline.canProcess(jsonContent)).toBe(true);
    });

    it("should reject non-JSON MIME types", () => {
      const htmlContent: RawContent = {
        content: "<html></html>",
        mimeType: "text/html",
        charset: "utf-8",
        source: "test.html",
      };

      expect(pipeline.canProcess(htmlContent)).toBe(false);
    });

    it("should reject content without MIME type", () => {
      const unknownContent: RawContent = {
        content: "{}",
        mimeType: "",
        charset: "utf-8",
        source: "test",
      };

      expect(pipeline.canProcess(unknownContent)).toBe(false);
    });
  });

  describe("process", () => {
    it("should process valid JSON object", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify({ name: "John", age: 30 }, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "user.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.metadata.title).toBe("John"); // extracted from name field
      expect(result.metadata.description).toBeUndefined(); // no description field found
      expect(result.metadata.isValidJson).toBe(true);
      expect(result.metadata.jsonStructure).toEqual({
        type: "object",
        depth: 1,
        propertyCount: 2,
      });
      expect(result.links).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should process valid JSON array", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify([1, 2, 3], null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "numbers.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.metadata.title).toBeUndefined(); // no title field in array
      expect(result.metadata.description).toBeUndefined(); // no description field in array
      expect(result.metadata.isValidJson).toBe(true);
      expect(result.metadata.jsonStructure).toEqual({
        type: "array",
        depth: 1,
        itemCount: 3,
      });
    });

    it("should extract title from JSON properties", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify(
          {
            title: "My API Documentation",
            version: "1.0.0",
            description: "REST API for user management",
          },
          null,
          2,
        ),
        mimeType: "application/json",
        charset: "utf-8",
        source: "api.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.metadata.title).toBe("My API Documentation");
      expect(result.metadata.description).toBe("REST API for user management");
    });

    it("should handle nested JSON structures", async () => {
      const nestedJson = {
        user: {
          profile: {
            personal: {
              name: "John",
              age: 30,
            },
          },
        },
        settings: {
          theme: "dark",
        },
      };

      const jsonContent: RawContent = {
        content: JSON.stringify(nestedJson, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "nested.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.metadata.jsonStructure).toEqual({
        type: "object",
        depth: 4, // user -> profile -> personal -> name/age
        propertyCount: 2, // user, settings
      });
    });

    it("should handle invalid JSON gracefully", async () => {
      const jsonContent: RawContent = {
        content: "{ invalid json content",
        mimeType: "application/json",
        charset: "utf-8",
        source: "invalid.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.metadata.title).toBeUndefined(); // no title/description fields for invalid JSON
      expect(result.metadata.description).toBeUndefined();
      expect(result.metadata.isValidJson).toBe(false);
      expect(result.metadata.jsonStructure).toBeUndefined();
    });

    it("should handle JSON primitives", async () => {
      const stringContent: RawContent = {
        content: '"hello world"',
        mimeType: "application/json",
        charset: "utf-8",
        source: "string.json",
      };

      const result = await pipeline.process(stringContent, baseOptions);

      expect(result.metadata.title).toBeUndefined(); // no title field in primitive
      expect(result.metadata.description).toBeUndefined(); // no description field in primitive
      expect(result.metadata.jsonStructure).toEqual({
        type: "string",
        depth: 1,
      });
    });

    it("should handle empty JSON structures", async () => {
      const emptyObjectContent: RawContent = {
        content: "{}",
        mimeType: "application/json",
        charset: "utf-8",
        source: "empty.json",
      };

      const result = await pipeline.process(emptyObjectContent, baseOptions);

      expect(result.metadata.title).toBeUndefined(); // no title field in empty object
      expect(result.metadata.description).toBeUndefined(); // no description field in empty object
      expect(result.metadata.jsonStructure).toEqual({
        type: "object",
        depth: 1,
        propertyCount: 0,
      });
    });

    it("should handle Buffer content", async () => {
      const jsonString = JSON.stringify({ test: "value" });
      const jsonContent: RawContent = {
        content: Buffer.from(jsonString, "utf-8"),
        mimeType: "application/json",
        charset: "utf-8",
        source: "buffer.json",
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonString);
      expect(result.metadata.isValidJson).toBe(true);
    });
  });
});
