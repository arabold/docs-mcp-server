/**
 * Unit tests for EmbeddingConfig class.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EmbeddingConfig,
  type EmbeddingModelConfig,
  SUPPORTED_PROVIDERS,
} from "./EmbeddingConfig";

describe("EmbeddingConfig", () => {
  // Reset singleton instance before and after each test to ensure isolation
  beforeEach(() => {
    EmbeddingConfig.resetInstance();
  });

  afterEach(() => {
    EmbeddingConfig.resetInstance();
  });

  it("parses provider, model, dimensions and modelSpec", () => {
    const cases: [
      label: string,
      spec: string | undefined,
      expected: Partial<EmbeddingModelConfig>,
    ][] = [
      [
        "no spec uses the default model",
        undefined,
        {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          modelSpec: "text-embedding-3-small",
        },
      ],
      [
        "an empty spec falls back to the default model and spec",
        "",
        {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 1536,
          modelSpec: "text-embedding-3-small",
        },
      ],
      [
        "an unprefixed model defaults to openai",
        "text-embedding-ada-002",
        {
          provider: "openai",
          model: "text-embedding-ada-002",
          dimensions: 1536,
          modelSpec: "text-embedding-ada-002",
        },
      ],
      [
        "a provider prefix",
        "gemini:embedding-001",
        {
          provider: "gemini",
          model: "embedding-001",
          dimensions: 768,
          modelSpec: "gemini:embedding-001",
        },
      ],
      [
        "an AWS model with a colon in its name",
        "aws:amazon.titan-embed-text-v2:0",
        {
          provider: "aws",
          model: "amazon.titan-embed-text-v2:0",
          dimensions: 1024,
          modelSpec: "aws:amazon.titan-embed-text-v2:0",
        },
      ],
      [
        "an unknown model has null dimensions",
        "openai:unknown-model",
        {
          provider: "openai",
          model: "unknown-model",
          dimensions: null,
          modelSpec: "openai:unknown-model",
        },
      ],
      [
        "a model name in another case finds the known dimensions",
        "openai:TEXT-EMBEDDING-3-SMALL",
        {
          provider: "openai",
          model: "TEXT-EMBEDDING-3-SMALL",
          dimensions: 1536,
          modelSpec: "openai:TEXT-EMBEDDING-3-SMALL",
        },
      ],
      [
        "vertex",
        "vertex:text-embedding-004",
        { provider: "vertex", model: "text-embedding-004", dimensions: 768 },
      ],
      [
        "microsoft",
        "microsoft:my-deployment",
        { provider: "microsoft", model: "my-deployment" },
      ],
      [
        "openai prefix",
        "openai:text-embedding-3-small",
        { provider: "openai", model: "text-embedding-3-small" },
      ],
      [
        "openai prefix before a GGUF model with a tag",
        "openai:second-state/model-GGUF:Q4_K_M",
        { provider: "openai", model: "second-state/model-GGUF:Q4_K_M" },
      ],
      // Prefixes match case-insensitively and resolve to their canonical form.
      [
        "a mixed-case prefix",
        "OpenAI:text-embedding-3-small",
        { provider: "openai", model: "text-embedding-3-small" },
      ],
      [
        "an upper-case prefix",
        "AWS:amazon.titan-embed-text-v2:0",
        { provider: "aws", model: "amazon.titan-embed-text-v2:0" },
      ],
      // GGUF and ollama tags are OpenAI-compatible model names, not provider prefixes
      ...[
        "second-state/jina-embeddings-v3-GGUF:Q4_K_M",
        "huoxu/bge-large-en-v1.5-Q8_0-GGUF",
        "nomic-embed-text:latest",
        "bge-m3:567m",
        "mxbai-embed-large:335m-v1-fp16",
        "jina-embeddings-v3-GGUF:Q4_K_M",
      ].map((spec): [string, string, Partial<EmbeddingModelConfig>] => [
        `model name ${spec}`,
        spec,
        { provider: "openai", model: spec },
      ]),
      ...SUPPORTED_PROVIDERS.map(
        (provider): [string, string, Partial<EmbeddingModelConfig>] => [
          `supported provider ${provider}`,
          `${provider}:test-model`,
          { provider, model: "test-model" },
        ],
      ),
      // Only the supported prefixes claim the provider slot; anything else is a model
      // name served by an OpenAI-compatible endpoint.
      [
        "an unknown prefix stays in the model name",
        "unknown:test-model",
        { provider: "openai", model: "unknown:test-model" },
      ],
      [
        "only a colon",
        ":",
        { provider: "openai", model: ":", dimensions: null, modelSpec: ":" },
      ],
      [
        "a leading colon",
        ":model-name",
        {
          provider: "openai",
          model: ":model-name",
          dimensions: null,
          modelSpec: ":model-name",
        },
      ],
      [
        "a trailing colon after an unknown prefix",
        "provider:",
        {
          provider: "openai",
          model: "provider:",
          dimensions: null,
          modelSpec: "provider:",
        },
      ],
      [
        "a trailing colon after a supported prefix",
        "openai:",
        { provider: "openai", model: "", dimensions: null, modelSpec: "openai:" },
      ],
    ];

    for (const [label, spec, expected] of cases) {
      expect.soft(new EmbeddingConfig().parse(spec), label).toMatchObject(expected);
      expect
        .soft(EmbeddingConfig.parseEmbeddingConfig(spec), `${label} (static)`)
        .toMatchObject(expected);
    }
  });

  it("strips the quotes Docker Compose leaves around a model spec (GH-353)", () => {
    const cases: [
      label: string,
      spec: string,
      expected: Partial<EmbeddingModelConfig>,
    ][] = [
      [
        "double quotes",
        '"openai:nomic-embed-text"',
        {
          provider: "openai",
          model: "nomic-embed-text",
          modelSpec: "openai:nomic-embed-text",
        },
      ],
      [
        "single quotes",
        "'openai:nomic-embed-text'",
        {
          provider: "openai",
          model: "nomic-embed-text",
          modelSpec: "openai:nomic-embed-text",
        },
      ],
      [
        "a model-only spec without a provider prefix",
        '"nomic-embed-text"',
        { provider: "openai", model: "nomic-embed-text", modelSpec: "nomic-embed-text" },
      ],
      [
        "whitespace around the quotes",
        '  "openai:nomic-embed-text"  ',
        { provider: "openai", model: "nomic-embed-text" },
      ],
      [
        "a quoted known model keeps its dimensions",
        '"openai:text-embedding-3-small"',
        { provider: "openai", model: "text-embedding-3-small", dimensions: 1536 },
      ],
    ];

    for (const [label, spec, expected] of cases) {
      expect.soft(new EmbeddingConfig().parse(spec), label).toMatchObject(expected);
    }
  });

  it("looks up the known dimensions of a model", () => {
    const cases: [label: string, model: string, expected: number | null][] = [
      ["an OpenAI model", "text-embedding-3-small", 1536],
      ["a large OpenAI model", "text-embedding-3-large", 3072],
      ["a Gemini model", "embedding-001", 768],
      ["an AWS model", "amazon.titan-embed-text-v1", 1536],
      ["an unknown model", "unknown-model", null],
      ["an upper-case name", "TEXT-EMBEDDING-3-SMALL", 1536],
      ["a mixed-case name", "Text-Embedding-3-Small", 1536],
      // Common OpenAI-compatible hosted model aliases
      ["a hosted e5 alias", "text-embedding-multilingual-e5-large", 1024],
      [
        "a hosted nomic alias with an owner",
        "keisuke-miyako/text-embedding-nomic-embed-text-v1.5",
        768,
      ],
      ["a hosted nomic alias", "nomic-embed-text-v1.5", 768],
      // Variable-dimension MRL entries need runtime detection
      ["MRL stella 1.5B", "NovaSearch/stella_en_1.5B_v5", null],
      ["MRL stella 400M", "NovaSearch/stella_en_400M_v5", null],
      ["MRL stella 400M by dunzhang", "dunzhang/stella_en_400M_v5", null],
      ["MRL jasper", "NovaSearch/jasper_en_vision_language_v1", null],
      // Current provider models from upstream
      ["Vertex text-embedding-005", "text-embedding-005", 768],
      ["Cohere embed v4", "Cohere/Cohere-embed-v4.0", 1536],
      ["voyage-4-large", "voyage-4-large", 1024],
      ["voyage-3.5", "voyage-3.5", 1024],
      ["nomic embed text v2 moe", "nomic-ai/nomic-embed-text-v2-moe", 768],
      ["nomic embed code", "nomic-ai/nomic-embed-code", 3584],
      // A tag or quantization suffix does not change the vector width, so the
      // base model's dimensions apply.
      ["a tagged variant", "nomic-ai/nomic-embed-text-v2-moe:latest", 768],
      ["a quantized variant", "text-embedding-3-small:Q8_0", 1536],
      // The colon belongs to this model's own identifier, not to a tag.
      [
        "an exact match over stripping a colon suffix",
        "amazon.titan-embed-text-v2:0",
        1024,
      ],
    ];

    const config = new EmbeddingConfig();
    for (const [label, model, expected] of cases) {
      expect.soft(config.getKnownDimensions(model), label).toBe(expected);
      expect
        .soft(EmbeddingConfig.getKnownModelDimensions(model), `${label} (static)`)
        .toBe(expected);
    }
  });

  it("caches a detected dimension case-insensitively, shared by instance and static access", () => {
    const instance = EmbeddingConfig.getInstance();
    expect(instance.getKnownDimensions("custom-model")).toBeNull();

    instance.setKnownDimensions("Custom-Model", 1024);
    expect(instance.getKnownDimensions("custom-model")).toBe(1024);
    expect(EmbeddingConfig.getInstance().getKnownDimensions("CUSTOM-MODEL")).toBe(1024);
    expect(EmbeddingConfig.getKnownModelDimensions("custom-model")).toBe(1024);

    // A later detection overwrites the cached value
    EmbeddingConfig.setKnownModelDimensions("custom-model", 2048);
    expect(instance.getKnownDimensions("Custom-Model")).toBe(2048);
  });

  it("resetInstance forgets cached dimensions", () => {
    const instance1 = EmbeddingConfig.getInstance();
    instance1.setKnownDimensions("reset-test", 256);

    EmbeddingConfig.resetInstance();

    const instance2 = EmbeddingConfig.getInstance();
    expect(instance2.getKnownDimensions("reset-test")).toBeNull(); // Should be gone
    expect(instance1).not.toBe(instance2); // Should be different instances
  });
});
