import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { BedrockEmbeddings } from "@langchain/aws";
import type { Embeddings } from "@langchain/core/embeddings";
import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import { AzureOpenAIEmbeddings, OpenAIEmbeddings } from "@langchain/openai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { MissingCredentialsError } from "../errors";
import type { EmbeddingProvider } from "./EmbeddingConfig";
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
  /** A client class `toBeInstanceOf` can check. */
  type EmbeddingsClass = abstract new (...args: never[]) => Embeddings;

  // Typed as a complete record so that adding a provider without adding it here
  // fails typecheck. This is the testable form of "every supported provider has a
  // model-creation branch" — the invariant `sagemaker` violated for a year.
  const PROVIDER_CLIENTS: Record<
    EmbeddingProvider,
    { spec: string; client: EmbeddingsClass; fields: Record<string, unknown> }
  > = {
    openai: {
      spec: "openai:text-embedding-3-small",
      client: OpenAIEmbeddings,
      fields: { modelName: "text-embedding-3-small" },
    },
    vertex: {
      spec: "vertex:text-embedding-004",
      client: VertexAIEmbeddings,
      fields: { model: "text-embedding-004" },
    },
    // Gemini supports MRL, so DocumentStore may truncate its vectors
    gemini: {
      spec: "gemini:gemini-embedding-exp-03-07",
      client: FixedDimensionEmbeddings,
      fields: { allowTruncate: true },
    },
    aws: {
      spec: "aws:amazon.titan-embed-text-v1",
      client: BedrockEmbeddings,
      fields: { model: "amazon.titan-embed-text-v1" },
    },
    microsoft: {
      spec: "microsoft:test-deployment",
      client: AzureOpenAIEmbeddings,
      fields: { azureOpenAIApiDeploymentName: "test-deployment" },
    },
  };

  test("creates the client of the provider a model spec names", () => {
    const cases: [
      label: string,
      spec: string,
      client: EmbeddingsClass,
      fields: Record<string, unknown>,
    ][] = [
      ...Object.entries(PROVIDER_CLIENTS).map(
        ([provider, { spec, client, fields }]): [
          string,
          string,
          EmbeddingsClass,
          Record<string, unknown>,
        ] => [`the ${provider} provider`, spec, client, fields],
      ),
      [
        "an unprefixed model name (default provider)",
        "text-embedding-3-small",
        OpenAIEmbeddings,
        { modelName: "text-embedding-3-small" },
      ],
      // Only the known provider prefixes claim the segment before the first colon;
      // everything else is a model name served by an OpenAI-compatible endpoint.
      [
        "an unrecognized prefix",
        "unknown:model",
        OpenAIEmbeddings,
        { modelName: "unknown:model" },
      ],
      [
        "the withdrawn sagemaker prefix",
        "sagemaker:my-endpoint",
        OpenAIEmbeddings,
        { modelName: "sagemaker:my-endpoint" },
      ],
    ];

    for (const [label, spec, client, fields] of cases) {
      const model = createEmbeddingModel(spec, runtimeConfig);
      expect.soft(model, label).toBeInstanceOf(client);
      expect.soft(model, label).toMatchObject(fields);
    }
  });

  test("throws MissingCredentialsError when a provider's credentials are missing", () => {
    const cases: [label: string, spec: string, env: Record<string, string>][] = [
      ["OpenAI, unprefixed, without OPENAI_API_KEY", "text-embedding-3-small", {}],
      ["OpenAI without OPENAI_API_KEY", "openai:text-embedding-3-small", {}],
      [
        "Vertex AI without GOOGLE_APPLICATION_CREDENTIALS",
        "vertex:text-embedding-004",
        {},
      ],
      ["Gemini without GOOGLE_API_KEY", "gemini:gemini-embedding-exp-03-07", {}],
      ["AWS Bedrock without credentials", "aws:amazon.titan-embed-text-v1", {}],
      [
        "Azure OpenAI without only AZURE_OPENAI_API_INSTANCE_NAME",
        "microsoft:text-embedding-ada-002",
        {
          AZURE_OPENAI_API_KEY: "test-azure-key",
          AZURE_OPENAI_API_DEPLOYMENT_NAME: "test-deployment",
          AZURE_OPENAI_API_VERSION: "2024-02-01",
        },
      ],
    ];

    for (const [label, spec, env] of cases) {
      vi.stubGlobal("process", { env });
      expect
        .soft(() => createEmbeddingModel(spec, runtimeConfig), label)
        .toThrow(MissingCredentialsError);
    }
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
});
