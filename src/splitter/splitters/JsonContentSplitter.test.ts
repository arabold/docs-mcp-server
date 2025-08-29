import { describe, expect, it } from "vitest";
import { MinimumChunkSizeError } from "../errors";
import { JsonContentSplitter } from "./JsonContentSplitter";

describe("JsonContentSplitter", () => {
  const defaultOptions = { chunkSize: 1000 };

  describe("simple JSON objects", () => {
    it("should split a simple object into structural chunks", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);
      const json = JSON.stringify({ name: "John", age: 30 }, null, 2);

      const chunks = await splitter.split(json);

      // New format: opening {, property chunks, closing }
      expect(chunks).toHaveLength(5); // { + name + , + age + }
      expect(chunks[0]).toBe("{");
      expect(chunks[1]).toContain("// Path: name");
      expect(chunks[1]).toContain('"name": "John"');
      expect(chunks[2]).toBe(",");
      expect(chunks[3]).toContain("// Path: age");
      expect(chunks[3]).toContain('"age": 30');
      expect(chunks[4]).toBe("}");
    });

    it("should split a simple array into structural chunks", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);
      const json = JSON.stringify([1, 2, 3], null, 2);

      const chunks = await splitter.split(json);

      // New format: opening [, item chunks with commas, closing ]
      expect(chunks).toHaveLength(7); // [ + item + , + item + , + item + ]
      expect(chunks[0]).toBe("[");
      expect(chunks[1]).toContain("// Path: [0]");
      expect(chunks[1]).toContain("1");
      expect(chunks[2]).toBe(",");
      expect(chunks[3]).toContain("// Path: [1]");
      expect(chunks[3]).toContain("2");
      expect(chunks[4]).toBe(",");
      expect(chunks[5]).toContain("// Path: [2]");
      expect(chunks[5]).toContain("3");
      expect(chunks[6]).toBe("]");
    });
  });

  describe("nested JSON structures", () => {
    it("should handle nested objects with proper path hierarchy", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);
      const json = JSON.stringify(
        {
          user: {
            name: "John",
            address: {
              street: "123 Main St",
              city: "Anytown",
            },
          },
        },
        null,
        2,
      );

      const chunks = await splitter.split(json);

      // Should include chunks for: root, user, user.name, user.address, user.address.street, user.address.city
      expect(chunks.length).toBeGreaterThan(4);

      // Check hierarchical paths
      const userChunk = chunks.find((chunk) => chunk.includes("// Path: user"));
      expect(userChunk).toBeDefined();

      const addressChunk = chunks.find((chunk) =>
        chunk.includes("// Path: user.address"),
      );
      expect(addressChunk).toBeDefined();

      const streetChunk = chunks.find((chunk) =>
        chunk.includes("// Path: user.address.street"),
      );
      expect(streetChunk).toBeDefined();
    });

    it("should handle arrays of objects", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);
      const json = JSON.stringify(
        [
          { id: 1, name: "John" },
          { id: 2, name: "Jane" },
        ],
        null,
        2,
      );

      const chunks = await splitter.split(json);

      // Should include root, array items, and object properties
      expect(chunks.length).toBeGreaterThan(6);

      // Check array indexing in paths
      const firstItem = chunks.find((chunk) => chunk.includes("// Path: [0]"));
      expect(firstItem).toBeDefined();

      const firstItemId = chunks.find((chunk) => chunk.includes("// Path: [0].id"));
      expect(firstItemId).toBeDefined();
    });
  });

  describe("primitive values", () => {
    it("should handle primitive JSON values as single chunks", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);

      const stringJson = '"hello world"';
      const stringChunks = await splitter.split(stringJson);
      expect(stringChunks).toHaveLength(1);
      expect(stringChunks[0]).toBe('"hello world"');

      const numberJson = "42";
      const numberChunks = await splitter.split(numberJson);
      expect(numberChunks).toHaveLength(1);
      expect(numberChunks[0]).toBe("42");

      const booleanJson = "true";
      const booleanChunks = await splitter.split(booleanJson);
      expect(booleanChunks).toHaveLength(1);
      expect(booleanChunks[0]).toBe("true");
    });
  });

  describe("size limits", () => {
    it("should handle content that exceeds chunk size", async () => {
      const smallSplitter = new JsonContentSplitter({ chunkSize: 50 });
      const largeObject = {
        description:
          "This is a very long description that will definitely exceed the chunk size limit and should be handled appropriately",
      };
      const json = JSON.stringify(largeObject, null, 2);

      const chunks = await smallSplitter.split(json);

      // Should still create chunks, potentially splitting large values
      expect(chunks.length).toBeGreaterThan(0);
      // Individual chunks might still be large due to minimum content requirements
      // but the splitter should handle this gracefully
    });

    it("should throw MinimumChunkSizeError for invalid JSON that's too large", async () => {
      const splitter = new JsonContentSplitter({ chunkSize: 10 });
      const invalidJson =
        "This is not valid JSON and is longer than the chunk size limit";

      await expect(splitter.split(invalidJson)).rejects.toThrow(MinimumChunkSizeError);
    });
  });

  describe("invalid JSON", () => {
    it("should handle invalid JSON gracefully for small content", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);
      const invalidJson = "not json";

      const chunks = await splitter.split(invalidJson);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe("not json");
    });
  });

  describe("empty structures", () => {
    it("should handle empty objects and arrays", async () => {
      const splitter = new JsonContentSplitter(defaultOptions);

      const emptyObject = "{}";
      const emptyObjectChunks = await splitter.split(emptyObject);
      expect(emptyObjectChunks).toHaveLength(2); // { + }
      expect(emptyObjectChunks[0]).toBe("{");
      expect(emptyObjectChunks[1]).toBe("}");

      const emptyArray = "[]";
      const emptyArrayChunks = await splitter.split(emptyArray);
      expect(emptyArrayChunks).toHaveLength(2); // [ + ]
      expect(emptyArrayChunks[0]).toBe("[");
      expect(emptyArrayChunks[1]).toBe("]");
    });
  });
});
