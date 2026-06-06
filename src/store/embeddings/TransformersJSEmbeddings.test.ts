import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the lazy loader so tests never touch the real (heavy) companion package.
const pipelineFactory = vi.fn();
const env: { cacheDir?: string } = {};

vi.mock("./transformersLoader", () => ({
  loadTransformers: vi.fn(async () => ({
    pipeline: pipelineFactory,
    env,
  })),
}));

import { TransformersJSEmbeddings } from "./TransformersJSEmbeddings";

const DIM = 4;

/**
 * Builds a fake feature-extraction pipeline that returns deterministic vectors.
 * For a single string it returns one vector; for an array it returns a flat tensor
 * of `inputs.length * DIM` numbers with dims `[n, DIM]`, mirroring Transformers.js.
 */
function makeFakeEncoder() {
  return vi.fn(async (input: string | string[]) => {
    const count = Array.isArray(input) ? input.length : 1;
    const data = new Float32Array(count * DIM);
    for (let i = 0; i < data.length; i++) {
      data[i] = i; // deterministic, easy to assert against
    }
    return { data, dims: [count, DIM] };
  });
}

beforeEach(() => {
  pipelineFactory.mockReset();
  env.cacheDir = undefined;
  delete process.env.TRANSFORMERS_CACHE;
});

describe("TransformersJSEmbeddings", () => {
  it("embeds a single query into a vector of the model dimension", async () => {
    const encoder = makeFakeEncoder();
    pipelineFactory.mockResolvedValue(encoder);

    const embeddings = new TransformersJSEmbeddings({ modelName: "test-model" });
    const vector = await embeddings.embedQuery("hello");

    expect(vector).toEqual([0, 1, 2, 3]);
    expect(pipelineFactory).toHaveBeenCalledWith("feature-extraction", "test-model", {
      device: "cpu",
    });
  });

  it("embeds multiple documents into separate vectors", async () => {
    const encoder = makeFakeEncoder();
    pipelineFactory.mockResolvedValue(encoder);

    const embeddings = new TransformersJSEmbeddings();
    const vectors = await embeddings.embedDocuments(["a", "b"]);

    expect(vectors).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it("returns an empty array for no documents without invoking the model", async () => {
    pipelineFactory.mockResolvedValue(makeFakeEncoder());

    const embeddings = new TransformersJSEmbeddings();
    const vectors = await embeddings.embedDocuments([]);

    expect(vectors).toEqual([]);
    expect(pipelineFactory).not.toHaveBeenCalled();
  });

  it("auto-detects the vector dimension from the model", async () => {
    pipelineFactory.mockResolvedValue(makeFakeEncoder());

    const embeddings = new TransformersJSEmbeddings();
    await expect(embeddings.getVectorDimension()).resolves.toBe(DIM);
  });

  it("initializes the pipeline only once across calls", async () => {
    pipelineFactory.mockResolvedValue(makeFakeEncoder());

    const embeddings = new TransformersJSEmbeddings();
    await embeddings.embedQuery("one");
    await embeddings.embedQuery("two");

    expect(pipelineFactory).toHaveBeenCalledTimes(1);
  });

  it("strips newlines from input by default", async () => {
    const encoder = makeFakeEncoder();
    pipelineFactory.mockResolvedValue(encoder);

    const embeddings = new TransformersJSEmbeddings();
    await embeddings.embedQuery("line1\nline2");

    expect(encoder).toHaveBeenCalledWith("line1 line2", expect.anything());
  });

  it("honors TRANSFORMERS_CACHE by setting the shared cacheDir before first use", async () => {
    process.env.TRANSFORMERS_CACHE = "/tmp/models";
    pipelineFactory.mockResolvedValue(makeFakeEncoder());

    const embeddings = new TransformersJSEmbeddings();
    await embeddings.embedQuery("hello");

    expect(env.cacheDir).toBe("/tmp/models");
  });

  it("selects the webgpu device when TRANSFORMERS_DEVICE is set", async () => {
    process.env.TRANSFORMERS_DEVICE = "webgpu";
    try {
      pipelineFactory.mockResolvedValue(makeFakeEncoder());
      const embeddings = new TransformersJSEmbeddings();
      await embeddings.embedQuery("hello");
      expect(pipelineFactory).toHaveBeenCalledWith(
        "feature-extraction",
        expect.any(String),
        { device: "webgpu" },
      );
    } finally {
      delete process.env.TRANSFORMERS_DEVICE;
    }
  });
});
