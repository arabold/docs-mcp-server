import { Embeddings } from "@langchain/core/embeddings";
import { describe, expect, test } from "vitest";
import { defaults } from "../../utils/config";
import { DimensionError } from "../errors";
import { FixedDimensionEmbeddings } from "./FixedDimensionEmbeddings";

// Suppress logger output during tests

// Mock embedding models that produce vectors of different sizes
class MockBaseEmbeddings extends Embeddings {
  constructor(private dimension: number) {
    super({});
  }

  async embedQuery(_text: string): Promise<number[]> {
    return Array(this.dimension).fill(1);
  }

  async embedDocuments(_documents: string[]): Promise<number[][]> {
    return [Array(this.dimension).fill(1)];
  }
}

describe("FixedDimensionEmbeddings", () => {
  const targetDimension = defaults.EMBEDDINGS_VECTOR_DIMENSION;

  test("should pass through vectors of correct dimension", async () => {
    const base = new MockBaseEmbeddings(targetDimension);
    const wrapper = new FixedDimensionEmbeddings(base, targetDimension, "test:model");

    const vector = await wrapper.embedQuery("test");
    expect(vector.length).toBe(targetDimension);
  });

  test("should pad vectors that are too short", async () => {
    const shortDimension = 1024;
    const base = new MockBaseEmbeddings(shortDimension);
    const wrapper = new FixedDimensionEmbeddings(base, targetDimension, "test:model");

    const vector = await wrapper.embedQuery("test");
    expect(vector.length).toBe(targetDimension);
    // Check that first part contains the original values
    expect(vector.slice(0, shortDimension)).toEqual(Array(shortDimension).fill(1));
    // Check that padding is zeros
    expect(vector.slice(shortDimension)).toEqual(
      Array(targetDimension - shortDimension).fill(0),
    );
  });

  test("should truncate oversized vectors when allowTruncate is true", async () => {
    const largeDimension = 2048;
    const base = new MockBaseEmbeddings(largeDimension);
    const wrapper = new FixedDimensionEmbeddings(
      base,
      targetDimension,
      "test:model",
      true,
    );

    const vector = await wrapper.embedQuery("test");
    expect(vector.length).toBe(targetDimension);
    expect(vector).toEqual(Array(targetDimension).fill(1));
  });

  test("should throw DimensionError for oversized vectors when allowTruncate is false", async () => {
    const largeDimension = 3072;
    const base = new MockBaseEmbeddings(largeDimension);
    const wrapper = new FixedDimensionEmbeddings(base, targetDimension, "test:model");

    await expect(() => wrapper.embedQuery("test")).rejects.toThrow(DimensionError);
  });

  test("should process multiple documents correctly", async () => {
    const shortDimension = 1024;
    const base = new MockBaseEmbeddings(shortDimension);
    const wrapper = new FixedDimensionEmbeddings(base, targetDimension, "test:model");

    const vectors = await wrapper.embedDocuments(["test1", "test2"]);
    expect(vectors.length).toBe(1); // Our mock returns just one vector
    expect(vectors[0].length).toBe(targetDimension);
    // Check padding
    expect(vectors[0].slice(shortDimension)).toEqual(
      Array(targetDimension - shortDimension).fill(0),
    );
  });
});
