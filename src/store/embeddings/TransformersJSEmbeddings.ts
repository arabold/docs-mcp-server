import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { Embeddings } from "@langchain/core/embeddings";

let transformersJSImportPromise: Promise<typeof import("@huggingface/transformers")> | null = null;

async function getTransformersJS() {
  if (!transformersJSImportPromise) {
    transformersJSImportPromise = import("@huggingface/transformers");
  }

  return transformersJSImportPromise;
}

async function pipeline(
  task: "feature-extraction",
  model: string,
  options?: { device?: "cpu" | "webgpu" },
): Promise<FeatureExtractionPipeline> {
  const { env, pipeline: transformersPipeline } = await getTransformersJS();
  const cacheDir = process.env.TRANSFORMERS_CACHE;

  // `env.cacheDir` is a singleton shared across all pipeline instances, so it
  // must be set before any `pipeline()` call. Do it lazily so importing this
  // module does not eagerly load Transformers.js when it is never used.
  if (cacheDir) {
    env.cacheDir = cacheDir;
  }

  return (await transformersPipeline(task, model, options)) as FeatureExtractionPipeline;
}

/**
 * Configuration options for Transformers.js embeddings.
 */
export interface TransformersJSEmbeddingsParams {
  /**
   * Model to use for embeddings. Defaults to BAAI/bge-small-en-v1.5.
   * Supports any sentence-transformers model available on HuggingFace.
   */
  modelName?: string;

  /**
   * Device to run inference on. Defaults to "cpu".
   * Set to "webgpu" to enable GPU acceleration (requires compatible hardware).
   * Can also be set via TRANSFORMERS_DEVICE environment variable.
   */
  device?: "cpu" | "webgpu";

  /**
   * Whether to normalize embeddings to unit length. Defaults to true.
   */
  normalize?: boolean;

  /**
   * Whether to strip newlines from input text. Defaults to true.
   */
  stripNewLines?: boolean;
}

/**
 * Transformers.js-based embeddings implementation using ONNX runtime.
 * Provides offline, local embedding generation without external API dependencies.
 *
 * Uses @huggingface/transformers to load and run sentence-transformers models
 * via ONNX runtime in Node.js. Automatically uses all available CPU cores.
 *
 * @example
 * ```typescript
 * const embeddings = new TransformersJSEmbeddings({
 *   modelName: "BAAI/bge-small-en-v1.5",
 *   normalize: true,
 * });
 *
 * const vector = await embeddings.embedQuery("Hello world");
 * const vectors = await embeddings.embedDocuments(["Doc 1", "Doc 2"]);
 * ```
 */
export class TransformersJSEmbeddings extends Embeddings {
  private modelName: string;
  private device: "cpu" | "webgpu";
  private normalize: boolean;
  private stripNewLines: boolean;

  private encoder: FeatureExtractionPipeline | null = null;
  private encoderPromise: Promise<FeatureExtractionPipeline> | null = null;
  private vectorDimension: number | null = null;

  constructor(params: TransformersJSEmbeddingsParams = {}) {
    super({});

    this.modelName = params.modelName || "BAAI/bge-small-en-v1.5";

    const envDevice = process.env.TRANSFORMERS_DEVICE?.toLowerCase();
    this.device = params.device ?? (envDevice === "webgpu" ? "webgpu" : "cpu");

    this.normalize = params.normalize ?? true;
    this.stripNewLines = params.stripNewLines ?? true;
  }

  /**
   * Lazily initializes the embedding pipeline.
   * Downloads and caches the model on first use.
   */
  private async getEncoder(): Promise<FeatureExtractionPipeline> {
    if (this.encoderPromise === null) {
      this.encoderPromise = pipeline("feature-extraction", this.modelName, {
        device: this.device,
      });
    }

    const encoder = await this.encoderPromise;

    this.encoder = encoder;
    return encoder;
  }

  /**
   * Gets the vector dimension for this model.
   * Auto-detects on first inference.
   */
  async getVectorDimension(): Promise<number> {
    if (this.vectorDimension !== null) {
      return this.vectorDimension;
    }

    const encoder = await this.getEncoder();
    const testOutput = await encoder("test", {
      pooling: "mean",
      normalize: this.normalize,
    });

    this.vectorDimension = testOutput.dims[1];
    return this.vectorDimension as number;
  }

  /**
   * Embeds a single query text.
   *
   * @param text The text to embed
   * @returns Promise resolving to the embedding vector
   */
  async embedQuery(text: string): Promise<number[]> {
    const processedText = this.stripNewLines ? text.replaceAll(/\n/g, " ") : text;
    const encoder = await this.getEncoder();

    const output = await encoder(processedText, {
      pooling: "mean",
      normalize: this.normalize,
    });

    const vector = Array.from(output.data) as number[];
    return vector;
  }

  /**
   * Embeds multiple documents in batch.
   *
   * @param documents Array of texts to embed
   * @returns Promise resolving to array of embedding vectors
   */
  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) {
      return [];
    }

    const processedDocs = this.stripNewLines
      ? documents.map((doc) => doc.replaceAll(/\n/g, " "))
      : documents;

    const encoder = await this.getEncoder();

    const output = await encoder(processedDocs, {
      pooling: "mean",
      normalize: this.normalize,
    });

    const vectors: number[][] = [];
    const tensor = output.data;
    const dimension = output.dims[1];

    for (let i = 0; i < documents.length; i++) {
      const start = i * dimension;
      const end = start + dimension;
      vectors.push(Array.from(tensor.slice(start, end)));
    }

    return vectors;
  }
}
