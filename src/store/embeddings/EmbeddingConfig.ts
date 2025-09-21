/**
 * Shared embedding model configuration service.
 * Provides synchronous parsing of embedding model configuration and known dimensions lookup.
 * Eliminates code duplication between DocumentStore and telemetry systems.
 *
 * All model lookups are case-insensitive to handle variations in model name capitalization.
 * Uses class-based approach to avoid mutable global state and improve testability.
 */

/**
 * Supported embedding model providers.
 */
export type EmbeddingProvider =
  | "openai"
  | "vertex"
  | "gemini"
  | "aws"
  | "microsoft"
  | "sagemaker";

/**
 * Embedding model configuration parsed from environment variables.
 */
export interface EmbeddingModelConfig {
  /** The provider (e.g., "openai", "gemini") */
  provider: EmbeddingProvider;
  /** The model name (e.g., "text-embedding-3-small") */
  model: string;
  /** Known dimensions for this model, or null if unknown */
  dimensions: number | null;
  /** The full model specification string (e.g., "openai:text-embedding-3-small") */
  modelSpec: string;
}

/**
 * Embedding configuration manager that handles model parsing and dimension caching.
 * Encapsulates state to avoid global variable issues and improve testability.
 */
export class EmbeddingConfig {
  private static instance: EmbeddingConfig | null = null;

  /**
   * Get the singleton instance of EmbeddingConfig.
   * Creates the instance if it doesn't exist.
   */
  static getInstance(): EmbeddingConfig {
    if (EmbeddingConfig.instance === null) {
      EmbeddingConfig.instance = new EmbeddingConfig();
    }
    return EmbeddingConfig.instance;
  }

  /**
   * Reset the singleton instance (useful for testing).
   */
  static resetInstance(): void {
    EmbeddingConfig.instance = null;
  }
  /**
   * Known dimensions for common embedding models.
   * This avoids expensive API calls for dimension detection in telemetry.
   *
   * Note: The "openai" provider also supports OpenAI-compatible APIs like:
   * - Ollama (local models)
   * - LMStudio (local models)
   * - Any service implementing OpenAI's embedding API
   */
  private readonly knownModelDimensions: Record<string, number> = {
    // OpenAI models (also works with Ollama, LMStudio, and other OpenAI-compatible APIs)
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,

    // Google Vertex AI models
    "text-embedding-004": 768,
    "textembedding-gecko@003": 768,
    "textembedding-gecko@002": 768,
    "textembedding-gecko@001": 768,

    // Google Gemini models (with MRL support)
    "text-embedding-preview-0409": 768,
    "embedding-001": 768,

    // AWS Bedrock models
    // Amazon Titan models
    "amazon.titan-embed-text-v1": 1536,
    "amazon.titan-embed-text-v2:0": 1024,
    "amazon.titan-embed-image-v1": 1024, // Image embedding model

    // Cohere models
    "cohere.embed-english-v3": 1024,
    "cohere.embed-multilingual-v3": 1024,

    // SageMaker models (hosted on AWS SageMaker)
    "intfloat/multilingual-e5-large": 1024,

    // Additional AWS models that might be supported
    // Note: Some of these might be placeholders - verify dimensions before use
    // "amazon.nova-embed-multilingual-v1:0": 4096, // Commented out as noted in source

    // MTEB Leaderboard models (source: https://huggingface.co/spaces/mteb/leaderboard)
    // Top performing models from Massive Text Embedding Benchmark
    "sentence-transformers/all-MiniLM-L6-v2": 384,
    "gemini-embedding-001": 3072,
    "Qwen/Qwen3-Embedding-8B": 4096,
    "Qwen/Qwen3-Embedding-4B": 2560,
    "Qwen/Qwen3-Embedding-0.6B": 1024,
    "Linq-AI-Research/Linq-Embed-Mistral": 4096,
    "Alibaba-NLP/gte-Qwen2-7B-instruct": 3584,
    "intfloat/multilingual-e5-large-instruct": 1024,
    "Salesforce/SFR-Embedding-Mistral": 4096,
    "text-multilingual-embedding-002": 768,
    "GritLM/GritLM-7B": 4096,
    "GritLM/GritLM-8x7B": 4096,
    "intfloat/e5-mistral-7b-instruct": 4096,
    "Cohere/Cohere-embed-multilingual-v3.0": 1024,
    "Alibaba-NLP/gte-Qwen2-1.5B-instruct": 8960,
    "Lajavaness/bilingual-embedding-large": 1024,
    "Salesforce/SFR-Embedding-2_R": 4096,
    "NovaSearch/stella_en_1.5B_v5": 8960,
    "NovaSearch/jasper_en_vision_language_v1": 8960,
    "nvidia/NV-Embed-v2": 4096,
    "OrdalieTech/Solon-embeddings-large-0.1": 1024,
    "BAAI/bge-m3": 1024,
    "HIT-TMG/KaLM-embedding-multilingual-mini-v1": 896,
    "jinaai/jina-embeddings-v3": 1024,
    "Alibaba-NLP/gte-multilingual-base": 768,
    "Lajavaness/bilingual-embedding-base": 768,
    "HIT-TMG/KaLM-embedding-multilingual-mini-instruct-v1": 896,
    "nvidia/NV-Embed-v1": 4096,
    "Cohere/Cohere-embed-multilingual-light-v3.0": 384,
    "manu/bge-m3-custom-fr": 1024,
    "Lajavaness/bilingual-embedding-small": 384,
    "Snowflake/snowflake-arctic-embed-l-v2.0": 1024,
    "intfloat/multilingual-e5-base": 768,
    "voyage-3-lite": 512,
    "voyage-3": 1024,
    "intfloat/multilingual-e5-small": 384,
    "Alibaba-NLP/gte-Qwen1.5-7B-instruct": 4096,
    "Snowflake/snowflake-arctic-embed-m-v2.0": 768,
    "deepvk/USER-bge-m3": 1024,
    "Cohere/Cohere-embed-english-v3.0": 1024,
    "Omartificial-Intelligence-Space/Arabic-labse-Matryoshka": 768,
    "ibm-granite/granite-embedding-278m-multilingual": 768,
    "NovaSearch/stella_en_400M_v5": 4096,
    "omarelshehy/arabic-english-sts-matryoshka": 1024,
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2": 768,
    "Omartificial-Intelligence-Space/Arabic-all-nli-triplet-Matryoshka": 768,
    "Haon-Chen/speed-embedding-7b-instruct": 4096,
    "sentence-transformers/LaBSE": 768,
    "WhereIsAI/UAE-Large-V1": 1024,
    "ibm-granite/granite-embedding-107m-multilingual": 384,
    "mixedbread-ai/mxbai-embed-large-v1": 1024,
    "intfloat/e5-large-v2": 1024,
    "avsolatorio/GIST-large-Embedding-v0": 1024,
    "sdadas/mmlw-e5-large": 1024,
    "nomic-ai/nomic-embed-text-v1": 768,
    "nomic-ai/nomic-embed-text-v1-ablated": 768,
    "intfloat/e5-base-v2": 768,
    "BAAI/bge-large-en-v1.5": 1024,
    "intfloat/e5-large": 1024,
    "Omartificial-Intelligence-Space/Arabic-MiniLM-L12-v2-all-nli-triplet": 384,
    "Cohere/Cohere-embed-english-light-v3.0": 384,
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": 768,
    "Gameselo/STS-multilingual-mpnet-base-v2": 768,
    "thenlper/gte-large": 1024,
    "avsolatorio/GIST-Embedding-v0": 768,
    "nomic-ai/nomic-embed-text-v1-unsupervised": 768,
    "infgrad/stella-base-en-v2": 768,
    "avsolatorio/NoInstruct-small-Embedding-v0": 384,
    "dwzhu/e5-base-4k": 768,
    "sdadas/mmlw-e5-base": 768,
    "voyage-multilingual-2": 1024,
    "McGill-NLP/LLM2Vec-Mistral-7B-Instruct-v2-mntp-supervised": 4096,
    "BAAI/bge-base-en-v1.5": 768,
    "avsolatorio/GIST-small-Embedding-v0": 384,
    "sdadas/mmlw-roberta-large": 1024,
    "nomic-ai/nomic-embed-text-v1.5": 768,
    "minishlab/potion-multilingual-128M": 256,
    "shibing624/text2vec-base-multilingual": 384,
    "thenlper/gte-base": 768,
    "intfloat/e5-small-v2": 384,
    "intfloat/e5-base": 768,
    "sentence-transformers/static-similarity-mrl-multilingual-v1": 1024,
    "manu/sentence_croissant_alpha_v0.3": 2048,
    "BAAI/bge-small-en-v1.5": 512,
    "thenlper/gte-small": 384,
    "sdadas/mmlw-e5-small": 384,
    "manu/sentence_croissant_alpha_v0.4": 2048,
    "manu/sentence_croissant_alpha_v0.2": 2048,
    "abhinand/MedEmbed-small-v0.1": 384,
    "ibm-granite/granite-embedding-125m-english": 768,
    "intfloat/e5-small": 384,
    "voyage-large-2-instruct": 1024,
    "sdadas/mmlw-roberta-base": 768,
    "Snowflake/snowflake-arctic-embed-l": 1024,
    "Mihaiii/Ivysaur": 384,
    "Snowflake/snowflake-arctic-embed-m-long": 768,
    "bigscience/sgpt-bloom-7b1-msmarco": 4096,
    "avsolatorio/GIST-all-MiniLM-L6-v2": 384,
    "sergeyzh/LaBSE-ru-turbo": 768,
    "sentence-transformers/all-mpnet-base-v2": 768,
    "Snowflake/snowflake-arctic-embed-m": 768,
    "Snowflake/snowflake-arctic-embed-s": 384,
    "sentence-transformers/all-MiniLM-L12-v2": 384,
    "Mihaiii/gte-micro-v4": 384,
    "Snowflake/snowflake-arctic-embed-m-v1.5": 768,
    "cointegrated/LaBSE-en-ru": 768,
    "Mihaiii/Bulbasaur": 384,
    "ibm-granite/granite-embedding-30m-english": 384,
    "deepfile/embedder-100p": 768,
    "Jaume/gemma-2b-embeddings": 2048,
    "OrlikB/KartonBERT-USE-base-v1": 768,
    "izhx/udever-bloom-7b1": 4096,
    "izhx/udever-bloom-1b1": 1024,
    "brahmairesearch/slx-v0.1": 384,
    "Mihaiii/Wartortle": 384,
    "izhx/udever-bloom-3b": 2048,
    "deepvk/USER-base": 768,
    "ai-forever/ru-en-RoSBERTa": 1024,
    "McGill-NLP/LLM2Vec-Mistral-7B-Instruct-v2-mntp-unsup-simcse": 4096,
    "Mihaiii/Venusaur": 384,
    "Snowflake/snowflake-arctic-embed-xs": 384,
    "jinaai/jina-embedding-b-en-v1": 768,
    "Mihaiii/gte-micro": 384,
    "aari1995/German_Semantic_STS_V2": 1024,
    "Mihaiii/Squirtle": 384,
    "OrlikB/st-polish-kartonberta-base-alpha-v1": 768,
    "sergeyzh/rubert-tiny-turbo": 312,
    "minishlab/potion-base-8M": 256,
    "minishlab/M2V_base_glove_subword": 256,
    "jinaai/jina-embedding-s-en-v1": 512,
    "minishlab/potion-base-4M": 128,
    "minishlab/M2V_base_output": 256,
    "DeepPavlov/rubert-base-cased-sentence": 768,
    "jinaai/jina-embeddings-v2-small-en": 512,
    "cointegrated/rubert-tiny2": 312,
    "minishlab/M2V_base_glove": 256,
    "cointegrated/rubert-tiny": 312,
    "silma-ai/silma-embeddding-matryoshka-v0.1": 768,
    "DeepPavlov/rubert-base-cased": 768,
    "Omartificial-Intelligence-Space/Arabic-mpnet-base-all-nli-triplet": 768,
    "izhx/udever-bloom-560m": 1024,
    "minishlab/potion-base-2M": 64,
    "DeepPavlov/distilrubert-small-cased-conversational": 768,
    "consciousAI/cai-lunaris-text-embeddings": 1024,
    "deepvk/deberta-v1-base": 768,
    "Omartificial-Intelligence-Space/Arabert-all-nli-triplet-Matryoshka": 768,
    "Omartificial-Intelligence-Space/Marbert-all-nli-triplet-Matryoshka": 768,
    "ai-forever/sbert_large_mt_nlu_ru": 1024,
    "ai-forever/sbert_large_nlu_ru": 1024,
    "malenia1/ternary-weight-embedding": 1024,
    "jinaai/jina-embeddings-v2-base-en": 768,
    "VPLabs/SearchMap_Preview": 4096,
    "Hum-Works/lodestone-base-4096-v1": 768,
    "jinaai/jina-embeddings-v4": 2048,
  };

  /**
   * Lowercase lookup map for case-insensitive model dimension queries.
   * Built lazily from knownModelDimensions to ensure consistency.
   */
  private modelLookup: Map<string, number>;

  constructor() {
    this.modelLookup = new Map();
    for (const [model, dimensions] of Object.entries(this.knownModelDimensions)) {
      this.modelLookup.set(model.toLowerCase(), dimensions);
    }
  }

  /**
   * Parse embedding model configuration from a provided model specification.
   * This is a synchronous operation that extracts provider, model, and known dimensions.
   *
   * Supports various providers:
   * - openai: OpenAI models and OpenAI-compatible APIs (Ollama, LMStudio, etc.)
   * - vertex: Google Cloud Vertex AI
   * - gemini: Google Generative AI
   * - aws: AWS Bedrock models
   * - microsoft: Azure OpenAI
   * - sagemaker: AWS SageMaker hosted models
   *
   * @param modelSpec Model specification (e.g., "openai:text-embedding-3-small"), defaults to "text-embedding-3-small"
   * @returns Parsed embedding model configuration
   */
  parse(modelSpec?: string): EmbeddingModelConfig {
    const spec = modelSpec || "text-embedding-3-small";

    // Parse provider and model from string (e.g., "gemini:embedding-001" or just "text-embedding-3-small")
    // Handle models that contain colons in their names (e.g., "aws:amazon.titan-embed-text-v2:0")
    const colonIndex = spec.indexOf(":");
    let provider: EmbeddingProvider;
    let model: string;

    if (colonIndex === -1) {
      // No colon found, default to OpenAI
      provider = "openai";
      model = spec;
    } else {
      // Split only on the first colon
      provider = spec.substring(0, colonIndex) as EmbeddingProvider;
      model = spec.substring(colonIndex + 1);
    }

    // Look up known dimensions (case-insensitive)
    const dimensions = this.modelLookup?.get(model.toLowerCase()) || null;

    return {
      provider,
      model,
      dimensions,
      modelSpec: spec,
    };
  }

  /**
   * Get the known dimensions for a specific model.
   * Returns null if the model dimensions are not known.
   * Uses case-insensitive lookup.
   *
   * @param model The model name (e.g., "text-embedding-3-small")
   * @returns Known dimensions or null
   */
  getKnownDimensions(model: string): number | null {
    return this.modelLookup?.get(model.toLowerCase()) || null;
  }

  /**
   * Add or update known dimensions for a model.
   * This can be used to cache discovered dimensions.
   * Stores both original case and lowercase for consistent lookup.
   *
   * @param model The model name
   * @param dimensions The dimensions to cache
   */
  setKnownDimensions(model: string, dimensions: number): void {
    this.knownModelDimensions[model] = dimensions;

    // Update lowercase lookup map
    if (this.modelLookup) {
      this.modelLookup.set(model.toLowerCase(), dimensions);
    }
  }

  /**
   * Static method to parse embedding model configuration using the singleton instance.
   * This maintains backward compatibility while using the class-based approach.
   */
  static parseEmbeddingConfig(modelSpec?: string): EmbeddingModelConfig {
    return EmbeddingConfig.getInstance().parse(modelSpec);
  }

  /**
   * Static method to get known model dimensions using the singleton instance.
   * This maintains backward compatibility while using the class-based approach.
   */
  static getKnownModelDimensions(model: string): number | null {
    return EmbeddingConfig.getInstance().getKnownDimensions(model);
  }

  /**
   * Static method to set known model dimensions using the singleton instance.
   * This maintains backward compatibility while using the class-based approach.
   */
  static setKnownModelDimensions(model: string, dimensions: number): void {
    EmbeddingConfig.getInstance().setKnownDimensions(model, dimensions);
  }
}
