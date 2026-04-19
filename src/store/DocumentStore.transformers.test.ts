/**
 * Tests for DocumentStore with Transformers.js embeddings.
 * Tests the dimension-detection path specific to Transformers.js.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../utils/config";
import { DocumentStore } from "./DocumentStore";
import { EmbeddingConfig } from "./embeddings/EmbeddingConfig";
import { TransformersJSEmbeddings } from "./embeddings/TransformersJSEmbeddings";

const appConfig = loadConfig();

// Model without known dimensions - used for testing the getVectorDimension() path
const UNKNOWN_DIMENSIONS_MODEL = "transformers:custom/unknown-transformers-model-xyz";

// Model with known dimensions (384) in EmbeddingConfig
const KNOWN_DIMENSIONS_MODEL = "transformers:sentence-transformers/all-MiniLM-L6-v2";

// Module-level mock for TransformersJSEmbeddings
const mockGetVectorDimension = vi.fn(async () => 384);
const mockEmbedQuery = vi.fn(async (_text: string) => new Array(384).fill(0.001));
const mockEmbedDocuments = vi.fn(async (_documents: string[]) => [
  new Array(384).fill(0.001),
]);

vi.mock("./embeddings/TransformersJSEmbeddings", async () => {
  const actual = await vi.importActual<
    typeof import("./embeddings/TransformersJSEmbeddings")
  >("./embeddings/TransformersJSEmbeddings");
  return {
    TransformersJSEmbeddings: class extends (actual as any).TransformersJSEmbeddings {
      async getVectorDimension() {
        return mockGetVectorDimension();
      }
      async embedQuery(text: string) {
        return mockEmbedQuery(text);
      }
      async embedDocuments(documents: string[]) {
        return mockEmbedDocuments(documents);
      }
    },
  };
});

describe("DocumentStore - Transformers.js dimension detection (unknown dimensions)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    EmbeddingConfig.resetInstance();

    // Configure transformers provider with a model that has NO known dimensions
    const embeddingConfig = EmbeddingConfig.parseEmbeddingConfig(
      UNKNOWN_DIMENSIONS_MODEL,
    );
    appConfig.app.embeddingModel = embeddingConfig.modelSpec;
  });

  afterEach(async () => {
    EmbeddingConfig.resetInstance();
  });

  it("should use Transformers.js getVectorDimension() for dimension detection", async () => {
    const store = new DocumentStore(":memory:", appConfig);
    await store.initialize();

    // @ts-expect-error Accessing private property for testing
    expect(store.modelDimension).toBe(384);
    // @ts-expect-error Accessing private property for testing
    expect(store.isVectorSearchEnabled).toBe(true);

    // Verify getVectorDimension was called (indicating the transformers path was taken)
    expect(mockGetVectorDimension).toHaveBeenCalled();

    await store.shutdown();
  });

  it("should detect vector dimension before embedding documents", async () => {
    const store = new DocumentStore(":memory:", appConfig);
    await store.initialize();

    // Verify getVectorDimension was called during initialization
    expect(mockGetVectorDimension).toHaveBeenCalled();

    await store.shutdown();
  });

  it("should return correct instance type", async () => {
    const store = new DocumentStore(":memory:", appConfig);
    await store.initialize();

    // @ts-expect-error Accessing private property for testing
    expect(store.embeddings).toBeInstanceOf(TransformersJSEmbeddings);

    await store.shutdown();
  });
});

describe("DocumentStore - Transformers.js with known dimensions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    EmbeddingConfig.resetInstance();

    // Configure transformers provider with a model that HAS known dimensions
    const embeddingConfig = EmbeddingConfig.parseEmbeddingConfig(KNOWN_DIMENSIONS_MODEL);
    appConfig.app.embeddingModel = embeddingConfig.modelSpec;
  });

  afterEach(async () => {
    EmbeddingConfig.resetInstance();
  });

  it("should use known dimensions for dimension detection", async () => {
    const store = new DocumentStore(":memory:", appConfig);
    await store.initialize();

    // @ts-expect-error Accessing private property for testing
    expect(store.modelDimension).toBe(384);
    // @ts-expect-error Accessing private property for testing
    expect(store.isVectorSearchEnabled).toBe(true);

    // Verify getVectorDimension was NOT called (known dimensions took priority)
    expect(mockGetVectorDimension).not.toHaveBeenCalled();

    await store.shutdown();
  });

  it("should persist transformers model identity in metadata", async () => {
    const store = new DocumentStore(":memory:", appConfig);
    await store.initialize();

    // Verify metadata was persisted (dimension is the db dimension, not model dimension)
    const metadata = store.getEmbeddingMetadata();
    expect(metadata.model).toBe("transformers:sentence-transformers/all-MiniLM-L6-v2");
    expect(metadata.dimension).toBe(String(appConfig.embeddings.vectorDimension));

    await store.shutdown();
  });

  it("should work with different transformers model names", async () => {
    // Update the model spec to use a different model
    const embeddingConfig = EmbeddingConfig.parseEmbeddingConfig(KNOWN_DIMENSIONS_MODEL);
    appConfig.app.embeddingModel = embeddingConfig.modelSpec;

    const store = new DocumentStore(":memory:", appConfig);
    await store.initialize();

    // @ts-expect-error Accessing private property for testing
    expect(store.modelDimension).toBe(384);

    // Verify metadata was persisted with the new model
    const metadata = store.getEmbeddingMetadata();
    expect(metadata.model).toBe("transformers:sentence-transformers/all-MiniLM-L6-v2");

    await store.shutdown();
  });
});
