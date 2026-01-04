import { describe, expect, it } from "vitest";
import { loadConfig } from "../../utils/config";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { JsonPipeline } from "./JsonPipeline";

describe("JsonPipeline", () => {
  const config = loadConfig();
  const pipeline = new JsonPipeline(config);
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
      const pipeline = new JsonPipeline(config);
      expect(pipeline.canProcess("application/json")).toBe(true);
    });

    it("should accept text/json MIME type", () => {
      const pipeline = new JsonPipeline(config);
      expect(pipeline.canProcess("text/json")).toBe(true);
    });

    it("should reject non-JSON MIME types", () => {
      const pipeline = new JsonPipeline(config);
      expect(pipeline.canProcess("text/html")).toBe(false);
    });

    it("should reject content without MIME type", () => {
      const pipeline = new JsonPipeline(config);
      expect(pipeline.canProcess("")).toBe(false);
    });
  });

  describe("process", () => {
    it("should process valid JSON object", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify({ name: "John", age: 30 }, null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "user.json",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.title).toBe("John"); // extracted from name field
      // expect(result.metadata.description).toBeUndefined(); // no description field found
      // expect(result.metadata.isValidJson).toBe(true);
      // expect(result.metadata.jsonStructure).toEqual({
      //   type: "object",
      //   depth: 1,
      //   propertyCount: 2,
      // });
      expect(result.links).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it("should process valid JSON array", async () => {
      const jsonContent: RawContent = {
        content: JSON.stringify([1, 2, 3], null, 2),
        mimeType: "application/json",
        charset: "utf-8",
        source: "numbers.json",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.title).toBeUndefined(); // no title field in array
      // expect(result.metadata.description).toBeUndefined(); // no description field in array
      // expect(result.metadata.isValidJson).toBe(true);
      // expect(result.metadata.jsonStructure).toEqual({
      //   type: "array",
      //   depth: 1,
      //   itemCount: 3,
      // });
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
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.title).toBe("My API Documentation");
      // expect(result.metadata.description).toBe("REST API for user management");
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
        status: FetchStatus.SUCCESS,
      };

      const _result = await pipeline.process(jsonContent, baseOptions);

      // expect(result.metadata.jsonStructure).toEqual({
      //   type: "object",
      //   depth: 4, // user -> profile -> personal -> name/age
      //   propertyCount: 2, // user, settings
      // });
    });

    it("should handle invalid JSON gracefully", async () => {
      const jsonContent: RawContent = {
        content: "{ invalid json content",
        mimeType: "application/json",
        charset: "utf-8",
        source: "invalid.json",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonContent.content);
      expect(result.title).toBeUndefined(); // no title/description fields for invalid JSON
      // expect(result.metadata.description).toBeUndefined();
      // expect(result.metadata.isValidJson).toBe(false);
      // expect(result.metadata.jsonStructure).toBeUndefined();
    });

    it("should handle JSON primitives", async () => {
      const stringContent: RawContent = {
        content: '"hello world"',
        mimeType: "application/json",
        charset: "utf-8",
        source: "string.json",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(stringContent, baseOptions);

      expect(result.title).toBeUndefined(); // no title field in primitive
      // expect(result.metadata.description).toBeUndefined(); // no description field in primitive
      // expect(result.metadata.jsonStructure).toEqual({
      //   type: "string",
      //   depth: 1,
      // });
    });

    it("should handle empty JSON structures", async () => {
      const emptyObjectContent: RawContent = {
        content: "{}",
        mimeType: "application/json",
        charset: "utf-8",
        source: "empty.json",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(emptyObjectContent, baseOptions);

      expect(result.title).toBeUndefined(); // no title field in empty object
      // expect(result.metadata.description).toBeUndefined(); // no description field in empty object
      // expect(result.metadata.jsonStructure).toEqual({
      //   type: "object",
      //   depth: 1,
      //   propertyCount: 0,
      // });
    });

    it("should handle Buffer content", async () => {
      const jsonString = JSON.stringify({ test: "value" });
      const jsonContent: RawContent = {
        content: Buffer.from(jsonString, "utf-8"),
        mimeType: "application/json",
        charset: "utf-8",
        source: "buffer.json",
        status: FetchStatus.SUCCESS,
      };

      const result = await pipeline.process(jsonContent, baseOptions);

      expect(result.textContent).toBe(jsonString);
      // expect(result.metadata.isValidJson).toBe(true);
    });
  });
});
