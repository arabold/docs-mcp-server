import { BedrockEmbeddings } from "@langchain/aws";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../../utils/config";
import { MissingCredentialsError } from "../errors";
import { createEmbeddingModel, UnsupportedProviderError } from "./EmbeddingFactory";
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

  test("should throw UnsupportedProviderError for unknown provider", () => {
    expect(() => createEmbeddingModel("unknown:model", runtimeConfig)).toThrow(
      UnsupportedProviderError,
    );
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
});
