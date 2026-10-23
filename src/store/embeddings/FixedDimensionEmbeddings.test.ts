import { Embeddings } from "@langchain/core/embeddings";
import { describe, expect, test } from "vitest";
import { defaults } from "../../utils/config";
import { DimensionError } from "../errors";
import { FixedDimensionEmbeddings } from "./FixedDimensionEmbeddings";

// Mock embedding models that produce vectors of different sizes
class MockBaseEmbeddings extends Embeddings {
  constructor(private dimension: number) {
    super({});
  }

  async embedQuery(_text: string): Promise<number[]> {
    return Array(this.dimension).fill(1);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map(() => Array(this.dimension).fill(1));
  }
}

describe("FixedDimensionEmbeddings", () => {
  const targetDimension = defaults.embeddings.vectorDimension;

  test("pads short vectors with zeros and passes exact-size ones through (query and documents)", async () => {
    const shortDimension = 1024;
    const padded = [
      ...Array(shortDimension).fill(1),
      ...Array(targetDimension - shortDimension).fill(0),
    ];
    const short = new FixedDimensionEmbeddings(
      new MockBaseEmbeddings(shortDimension),
      targetDimension,
      "test:model",
    );
    const exact = new FixedDimensionEmbeddings(
      new MockBaseEmbeddings(targetDimension),
      targetDimension,
      "test:model",
    );

    expect(await short.embedQuery("test")).toEqual(padded);
    expect(await short.embedDocuments(["test1", "test2"])).toEqual([padded, padded]);
    expect(await exact.embedQuery("test")).toEqual(Array(targetDimension).fill(1));
  });

  test("truncates oversized vectors when allowTruncate is true", async () => {
    const cases: [label: string, dimension: number, spec: string][] = [
      ["a 2048-dimension vector", 2048, "test:model"],
      ["a Gemini-sized 3072-dimension vector", 3072, "gemini:gemini-embedding-001"],
    ];

    for (const [label, dimension, spec] of cases) {
      const wrapper = new FixedDimensionEmbeddings(
        new MockBaseEmbeddings(dimension),
        targetDimension,
        spec,
        true,
      );
      expect
        .soft(await wrapper.embedQuery("test"), label)
        .toEqual(Array(targetDimension).fill(1));
    }
  });

  test("rejects an oversized vector when allowTruncate is false, naming the model spec verbatim", async () => {
    // The spec is carried verbatim rather than split and rejoined, so segments
    // after a second colon survive into the diagnostic, and an unprefixed spec
    // gets no prefix.
    for (const spec of ["gemini:model:tag", "nomic-embed-text:latest"]) {
      const wrapper = new FixedDimensionEmbeddings(
        new MockBaseEmbeddings(3072),
        targetDimension,
        spec,
      );
      const error = await wrapper.embedQuery("test").catch((e: unknown) => e);

      expect.soft(error, spec).toBeInstanceOf(DimensionError);
      expect.soft(String(error), spec).toContain(`Model "${spec}"`);
    }
  });
});
