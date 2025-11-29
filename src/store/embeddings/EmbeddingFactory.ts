import { BedrockEmbeddings } from "@langchain/aws";
import type { Embeddings } from "@langchain/core/embeddings";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { VertexAIEmbeddings } from "@langchain/google-vertexai";
import {
  AzureOpenAIEmbeddings,
  type ClientOptions,
  OpenAIEmbeddings,
  type OpenAIEmbeddingsParams,
} from "@langchain/openai";
import { MissingCredentialsError } from "../errors";
import { VECTOR_DIMENSION } from "../types";
import { FixedDimensionEmbeddings } from "./FixedDimensionEmbeddings";

/**
 * Supported embedding model providers. Each provider requires specific environment
 * variables to be set for API access.
 */
export type EmbeddingProvider =
  | "openai"
  | "vertex"
  | "gemini"
  | "aws"
  | "microsoft"
  | "sagemaker";

/**
 * Error thrown when an invalid or unsupported embedding provider is specified.
 */
export class UnsupportedProviderError extends Error {
  constructor(provider: string) {
    super(
      `❌ Unsupported embedding provider: ${provider}\n` +
        "   Supported providers: openai, vertex, gemini, aws, microsoft, sagemaker\n" +
        "   See README.md for configuration options or run with --help for more details.",
    );
    this.name = "UnsupportedProviderError";
  }
}

/**
 * Error thrown when there's an issue with the model configuration or missing environment variables.
 */
export class ModelConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

/**
 * Checks if credentials are available for a specific embedding provider.
 * Returns true if any credentials are found, false if no credentials are provided.
 * Does not validate if the credentials are correct, only if they are present.
 *
 * @param provider The embedding provider to check
 * @returns true if credentials are available, false if no credentials found
 */
export function areCredentialsAvailable(provider: EmbeddingProvider): boolean {
  switch (provider) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;

    case "vertex":
      return !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

    case "gemini":
      return !!process.env.GOOGLE_API_KEY;

    case "aws": {
      const region = process.env.BEDROCK_AWS_REGION || process.env.AWS_REGION;
      return (
        !!region &&
        (!!process.env.AWS_PROFILE ||
          (!!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY))
      );
    }

    case "microsoft":
      return !!(
        process.env.AZURE_OPENAI_API_KEY &&
        process.env.AZURE_OPENAI_API_INSTANCE_NAME &&
        process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME &&
        process.env.AZURE_OPENAI_API_VERSION
      );

    case "sagemaker": {
      const region = process.env.AWS_REGION;
      return (
        !!region &&
        (!!process.env.AWS_PROFILE ||
          (!!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY))
      );
    }

    default:
      return false;
  }
}

/**
 * Creates an embedding model instance based on the specified provider and model name.
 * The provider and model name should be specified in the format "provider:model_name"
 * (e.g., "google:text-embedding-004"). If no provider is specified (i.e., just "model_name"),
 * OpenAI is used as the default provider.
 *
 * Environment variables required per provider:
 * - OpenAI: OPENAI_API_KEY (and optionally OPENAI_API_BASE, OPENAI_ORG_ID)
 * - Google Cloud Vertex AI: GOOGLE_APPLICATION_CREDENTIALS (path to service account JSON)
 * - Google GenAI (Gemini): GOOGLE_API_KEY
 * - AWS: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (or BEDROCK_AWS_REGION)
 * - Microsoft: AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_INSTANCE_NAME, AZURE_OPENAI_API_DEPLOYMENT_NAME, AZURE_OPENAI_API_VERSION
 *
 * @param providerAndModel - The provider and model name in the format "provider:model_name"
 *                          or just "model_name" for OpenAI models.
 * @returns A configured instance of the appropriate Embeddings implementation.
 * @throws {UnsupportedProviderError} If an unsupported provider is specified.
 * @throws {ModelConfigurationError} If there's an issue with the model configuration.
 */
export function createEmbeddingModel(providerAndModel: string): Embeddings {
  // Parse provider and model name
  const [providerOrModel, ...modelNameParts] = providerAndModel.split(":");
  const modelName = modelNameParts.join(":");
  const provider = modelName ? (providerOrModel as EmbeddingProvider) : "openai";
  const model = modelName || providerOrModel;

  // Default configuration for each provider
  const baseConfig = { stripNewLines: true };

  switch (provider) {
    case "openai": {
      if (!process.env.OPENAI_API_KEY) {
        throw new MissingCredentialsError("openai", ["OPENAI_API_KEY"]);
      }
      const timeoutMs = 30_000;
      const config: Partial<OpenAIEmbeddingsParams> & { configuration?: ClientOptions } =
        {
          ...baseConfig,
          modelName: model,
          batchSize: 512, // OpenAI supports large batches
          timeout: timeoutMs,
        };
      // Add custom base URL if specified
      const baseURL = process.env.OPENAI_API_BASE;
      if (baseURL) {
        config.configuration = { baseURL, timeout: timeoutMs };
      } else {
        config.configuration = { timeout: timeoutMs };
      }
      return new OpenAIEmbeddings(config);
    }

    case "vertex": {
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new MissingCredentialsError("vertex", ["GOOGLE_APPLICATION_CREDENTIALS"]);
      }
      return new VertexAIEmbeddings({
        ...baseConfig,
        model: model, // e.g., "text-embedding-004"
      });
    }

    case "gemini": {
      if (!process.env.GOOGLE_API_KEY) {
        throw new MissingCredentialsError("gemini", ["GOOGLE_API_KEY"]);
      }
      // Create base embeddings and wrap with FixedDimensionEmbeddings since Gemini
      // supports MRL (Matryoshka Representation Learning) for safe truncation
      const baseEmbeddings = new GoogleGenerativeAIEmbeddings({
        ...baseConfig,
        apiKey: process.env.GOOGLE_API_KEY,
        model: model, // e.g., "gemini-embedding-exp-03-07"
      });
      return new FixedDimensionEmbeddings(
        baseEmbeddings,
        VECTOR_DIMENSION,
        providerAndModel,
        true,
      );
    }

    case "aws": {
      // For AWS, model should be the full Bedrock model ID
      const region = process.env.BEDROCK_AWS_REGION || process.env.AWS_REGION;
      const missingCredentials: string[] = [];

      if (!region) {
        missingCredentials.push("BEDROCK_AWS_REGION or AWS_REGION");
      }

      // Allow using AWS_PROFILE for credentials if set
      if (
        !process.env.AWS_PROFILE &&
        !process.env.AWS_ACCESS_KEY_ID &&
        !process.env.AWS_SECRET_ACCESS_KEY
      ) {
        missingCredentials.push(
          "AWS_PROFILE or (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)",
        );
      }

      if (missingCredentials.length > 0) {
        throw new MissingCredentialsError("aws", missingCredentials);
      }

      // Only pass explicit credentials if present, otherwise let SDK resolve via profile/other means
      const credentials =
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              sessionToken: process.env.AWS_SESSION_TOKEN,
            }
          : undefined;

      return new BedrockEmbeddings({
        ...baseConfig,
        model: model, // e.g., "amazon.titan-embed-text-v1"
        region,
        ...(credentials ? { credentials } : {}),
      });
    }

    case "microsoft": {
      // For Azure, model name corresponds to the deployment name
      const missingCredentials: string[] = [];

      if (!process.env.AZURE_OPENAI_API_KEY) {
        missingCredentials.push("AZURE_OPENAI_API_KEY");
      }
      if (!process.env.AZURE_OPENAI_API_INSTANCE_NAME) {
        missingCredentials.push("AZURE_OPENAI_API_INSTANCE_NAME");
      }
      if (!process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME) {
        missingCredentials.push("AZURE_OPENAI_API_DEPLOYMENT_NAME");
      }
      if (!process.env.AZURE_OPENAI_API_VERSION) {
        missingCredentials.push("AZURE_OPENAI_API_VERSION");
      }

      if (missingCredentials.length > 0) {
        throw new MissingCredentialsError("microsoft", missingCredentials);
      }

      return new AzureOpenAIEmbeddings({
        ...baseConfig,
        azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
        azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
        azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
        azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
        deploymentName: model,
      });
    }

    default:
      throw new UnsupportedProviderError(provider);
  }
}
