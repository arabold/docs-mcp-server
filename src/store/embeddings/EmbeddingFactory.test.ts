import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BedrockEmbeddings } from "@langchain/aws";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { sanitizeEnvironment } from "../../utils/env";
import { MissingCredentialsError } from "../errors";
import { createEmbeddingModel } from "./EmbeddingFactory";
import { FixedDimensionEmbeddings } from "./FixedDimensionEmbeddings";

// Suppress logger output during tests

// Mock process.env for each test
const originalEnv = process.env;
const appConfig = loadConfig();
const runtimeConfig = {
  vectorDimension: appConfig.embeddings.vectorDimension,
  config: appConfig.embeddings,
};

beforeEach(() => {
  vi.stubGlobal("process", {
    env: {
      OPENAI_API_KEY: "test-openai-key",
      GOOGLE_APPLICATION_CREDENTIALS: "credentials.json",
      GOOGLE_API_KEY: "test-gemini-key",
      BEDROCK_AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test-aws-key",
      AWS_SECRET_ACCESS_KEY: "test-aws-secret",
      AZURE_OPENAI_API_KEY: "test-azure-key",
      AZURE_OPENAI_API_INSTANCE_NAME: "test-instance",
      AZURE_OPENAI_API_DEPLOYMENT_NAME: "test-deployment",
      AZURE_OPENAI_API_VERSION: "2024-02-01",
    },
  });
});

afterEach(() => {
  vi.stubGlobal("process", { env: originalEnv });
  vi.resetModules();
});

describe("createEmbeddingModel", () => {
  test("should create OpenAI embeddings with just model name (default provider)", () => {
    const model = createEmbeddingModel("text-embedding-3-small", runtimeConfig);
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model).toMatchObject({
      modelName: "text-embedding-3-small",
    });
  });

  test("should create OpenAI embeddings with explicit provider", () => {
    const model = createEmbeddingModel("openai:text-embedding-3-small", runtimeConfig);
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model).toMatchObject({
      modelName: "text-embedding-3-small",
    });
  });

  test("should throw MissingCredentialsError for OpenAI without OPENAI_API_KEY", () => {
    vi.stubGlobal("process", {
      env: {
        // Missing OPENAI_API_KEY
      },
    });

    expect(() => createEmbeddingModel("text-embedding-3-small", runtimeConfig)).toThrow(
      MissingCredentialsError,
    );
    expect(() =>
      createEmbeddingModel("openai:text-embedding-3-small", runtimeConfig),
    ).toThrow(MissingCredentialsError);
  });

  test("should correctly parse model names containing colons or slashes", () => {
    const model = createEmbeddingModel(
      "openai:jeffh/intfloat-multilingual-e5-large-instruct:f16",
      runtimeConfig,
    );
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model).toMatchObject({
      modelName: "jeffh/intfloat-multilingual-e5-large-instruct:f16",
    });
  });

  test.each([
    "second-state/jina-embeddings-v3-GGUF:Q4_K_M",
    "nomic-embed-text:latest",
    "bge-m3:567m",
    "jina-embeddings-v3-GGUF:Q4_K_M",
  ])("should create OpenAI-compatible embeddings for %s", (spec) => {
    const model = createEmbeddingModel(spec, runtimeConfig);
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model).toMatchObject({ modelName: spec });
  });

  test("should create Google Vertex AI embeddings", () => {
    const model = createEmbeddingModel("vertex:text-embedding-004", runtimeConfig);
    expect(model).toBeInstanceOf(VertexAIEmbeddings);
    expect(model).toMatchObject({
      model: "text-embedding-004",
    });
  });

  test("should create Google Gemini embeddings with MRL truncation enabled", () => {
    const model = createEmbeddingModel(
      "gemini:gemini-embedding-exp-03-07",
      runtimeConfig,
    );
    expect(model).toBeInstanceOf(FixedDimensionEmbeddings);

    // The FixedDimensionEmbeddings should wrap a GoogleGenerativeAIEmbeddings instance
    const embeddingsProp = Object.entries(model).find(
      ([key]) => key === "embeddings",
    )?.[1];
    expect(embeddingsProp).toBeInstanceOf(GoogleGenerativeAIEmbeddings);
    expect(embeddingsProp).toMatchObject({
      apiKey: "test-gemini-key",
      model: "gemini-embedding-exp-03-07",
    });
  });

  test("should throw MissingCredentialsError for Vertex AI without GOOGLE_APPLICATION_CREDENTIALS", () => {
    vi.stubGlobal("process", {
      env: {
        // Missing GOOGLE_APPLICATION_CREDENTIALS
      },
    });

    expect(() =>
      createEmbeddingModel("vertex:text-embedding-004", runtimeConfig),
    ).toThrow(MissingCredentialsError);
  });

  test("should throw MissingCredentialsError for Gemini without GOOGLE_API_KEY", () => {
    vi.stubGlobal("process", {
      env: {
        // Missing GOOGLE_API_KEY
      },
    });

    expect(() =>
      createEmbeddingModel("gemini:gemini-embedding-exp-03-07", runtimeConfig),
    ).toThrow(MissingCredentialsError);
  });

  test("should create AWS Bedrock embeddings", () => {
    const model = createEmbeddingModel("aws:amazon.titan-embed-text-v1", runtimeConfig);
    expect(model).toBeInstanceOf(BedrockEmbeddings);
    expect(model).toMatchObject({
      model: "amazon.titan-embed-text-v1",
    });
  });

  test("should treat an unrecognized prefix as an OpenAI-compatible model name", () => {
    // Only the known provider prefixes claim the segment before the first colon;
    // everything else is a model name served by an OpenAI-compatible endpoint.
    const model = createEmbeddingModel("unknown:model", runtimeConfig);
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model).toMatchObject({ modelName: "unknown:model" });
  });

  test("should throw MissingCredentialsError for Azure OpenAI without required env vars", () => {
    // Override env to simulate missing Azure variables
    vi.stubGlobal("process", {
      env: {
        AZURE_OPENAI_API_KEY: "test-azure-key",
        // Missing AZURE_OPENAI_API_INSTANCE_NAME
        AZURE_OPENAI_API_DEPLOYMENT_NAME: "test-deployment",
        AZURE_OPENAI_API_VERSION: "2024-02-01",
      },
    });

    expect(() =>
      createEmbeddingModel("microsoft:text-embedding-ada-002", runtimeConfig),
    ).toThrow(MissingCredentialsError);
  });

  test("should throw MissingCredentialsError for AWS Bedrock without required env vars", () => {
    // Override env to simulate missing AWS credentials
    vi.stubGlobal("process", {
      env: {
        // Missing AWS credentials
      },
    });

    expect(() =>
      createEmbeddingModel("aws:amazon.titan-embed-text-v1", runtimeConfig),
    ).toThrow(MissingCredentialsError);
  });

  test("should create AWS Bedrock embeddings with only AWS_PROFILE set", () => {
    vi.stubGlobal("process", {
      env: {
        AWS_PROFILE: "test-profile",
        BEDROCK_AWS_REGION: "us-east-1",
      },
    });
    const model = createEmbeddingModel("aws:amazon.titan-embed-text-v1", runtimeConfig);
    expect(model).toBeInstanceOf(BedrockEmbeddings);
    expect(model).toMatchObject({
      model: "amazon.titan-embed-text-v1",
    });
  });

  test("should request float encoding for OpenAI-compatible providers", () => {
    // Regression guard for #469: without an explicit encodingFormat the OpenAI SDK
    // sends `encoding_format: "base64"` and then base64-decodes the reply. Providers
    // that ignore the parameter return JSON floats, which decode into an all-zero
    // vector a quarter of the native length.
    const model = createEmbeddingModel("openai:mistral-embed", runtimeConfig);
    expect(model).toBeInstanceOf(OpenAIEmbeddings);
    expect(model).toMatchObject({ encodingFormat: "float" });
  });

  describe("providers that ignore encoding_format", () => {
    /**
     * Stands in for Mistral / LM Studio / Ollama: accepts `encoding_format` and
     * then ignores it, always replying with JSON float arrays. Reproduces #469
     * without needing an API key or a paid provider.
     */
    function startProvider(nativeDimension: number) {
      const received: Array<string | undefined> = [];
      const server = createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          received.push(JSON.parse(body || "{}").encoding_format);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              object: "list",
              model: "mistral-embed",
              data: [
                {
                  object: "embedding",
                  index: 0,
                  embedding: Array.from(
                    { length: nativeDimension },
                    (_, i) => Math.sin(i + 1) * 0.05,
                  ),
                },
              ],
              usage: { prompt_tokens: 1, total_tokens: 1 },
            }),
          );
        });
      });
      return { server, received };
    }

    test("should store full-length non-zero vectors from a float-only provider", async () => {
      const nativeDimension = 1024;
      const { server, received } = startProvider(nativeDimension);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve()),
      );
      const { port } = server.address() as AddressInfo;

      try {
        vi.stubGlobal("process", {
          env: {
            OPENAI_API_KEY: "test-openai-key",
            OPENAI_API_BASE: `http://127.0.0.1:${port}/v1`,
          },
        });

        const model = createEmbeddingModel("openai:mistral-embed", {
          vectorDimension: nativeDimension,
        });
        const vector = await model.embedQuery("test");

        // Pre-fix, the OpenAI SDK sent `encoding_format: "base64"` and then
        // base64-decoded the JSON floats, yielding 256 zeros instead of 1024
        // values — silently, with no error raised.
        expect(received).toEqual(["float"]);
        expect(vector).toHaveLength(nativeDimension);
        expect(vector.every((value) => value === 0)).toBe(false);
        expect(vector.filter((value) => value !== 0)).toHaveLength(nativeDimension);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe("OPENAI_API_BASE handling", () => {
    test("should use sanitized OPENAI_API_BASE values", () => {
      const env = {
        OPENAI_API_KEY: '"test-openai-key"',
        OPENAI_API_BASE: '"http://localhost:11434/v1"',
      };
      sanitizeEnvironment(env);
      vi.stubGlobal("process", { env });

      const model = createEmbeddingModel("openai:nomic-embed-text", runtimeConfig);
      expect(model).toBeInstanceOf(OpenAIEmbeddings);

      const clientConfig = (model as any).clientConfig;
      if (clientConfig?.baseURL) {
        expect(clientConfig.baseURL).toBe("http://localhost:11434/v1");
      }
    });
  });
});
