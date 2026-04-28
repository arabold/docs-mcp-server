import { beforeEach, describe, expect, test, vi } from "vitest";
import { TransformersJSEmbeddings } from "./TransformersJSEmbeddings";

// Mock the @huggingface/transformers pipeline
vi.mock("@huggingface/transformers", async (importOriginal) => {
  const original = await importOriginal();

  const mockEncoder = async (
    texts: string | string[],
    _options: { pooling?: string; normalize?: boolean } = {},
  ) => {
    const docs = Array.isArray(texts) ? texts : [texts];
    const dimension = 384;

    // Create mock tensor data
    const data = new Float32Array(docs.length * dimension);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 0.1;
    }

    return {
      data,
      dims: [docs.length, dimension],
      tolist: () => Array.from(data),
    };
  };

  const mockPipeline = vi.fn();
  mockPipeline.mockResolvedValue(mockEncoder);

  return {
    ...(original as any),
    pipeline: mockPipeline,
    env: {},
  };
});

describe("TransformersJSEmbeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TRANSFORMERS_DEVICE;
  });

  test("should embed single query", async () => {
    const embeddings = new TransformersJSEmbeddings({
      modelName: "Xenova/all-MiniLM-L6-v2",
    });

    const vector = await embeddings.embedQuery("Hello world");

    expect(vector).toBeInstanceOf(Array);
    expect(vector.length).toBeGreaterThan(0);
    expect(vector.every((v: number) => typeof v === "number")).toBe(true);
  });

  test("should embed multiple documents in batch", async () => {
    const embeddings = new TransformersJSEmbeddings();
    const docs = ["Document 1", "Document 2", "Document 3"];

    const vectors = await embeddings.embedDocuments(docs);

    expect(vectors).toBeInstanceOf(Array);
    expect(vectors.length).toBe(3);
    expect(vectors.every((v: number[]) => v.length > 0)).toBe(true);
  });

  test("should auto-detect vector dimension", async () => {
    const embeddings = new TransformersJSEmbeddings({
      modelName: "Xenova/all-MiniLM-L6-v2",
    });

    const dimension = await embeddings.getVectorDimension();

    expect(dimension).toBeGreaterThan(0);
    expect(typeof dimension).toBe("number");
  });

  test("should cache dimension after first detection", async () => {
    const embeddings = new TransformersJSEmbeddings();

    const dim1 = await embeddings.getVectorDimension();
    const dim2 = await embeddings.getVectorDimension();

    expect(dim1).toBe(dim2);
  });

  test("should handle empty document array", async () => {
    const embeddings = new TransformersJSEmbeddings();

    const vectors = await embeddings.embedDocuments([]);

    expect(vectors).toEqual([]);
  });
});
