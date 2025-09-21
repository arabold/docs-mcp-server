import { DocumentManagementClient } from "./DocumentManagementClient";
import { DocumentManagementService } from "./DocumentManagementService";
import type { EmbeddingModelConfig } from "./embeddings/EmbeddingConfig";
import type { IDocumentManagement } from "./trpc/interfaces";

export * from "./DocumentManagementClient";
export * from "./DocumentManagementService";
export * from "./DocumentStore";
export * from "./errors";
export * from "./trpc/interfaces";

/** Factory to create a document management implementation */
export async function createDocumentManagement(
  options: {
    serverUrl?: string;
    embeddingConfig?: EmbeddingModelConfig | null;
    storePath?: string;
  } = {},
) {
  if (options.serverUrl) {
    const client = new DocumentManagementClient(options.serverUrl);
    await client.initialize();
    return client as IDocumentManagement;
  }
  const service = new DocumentManagementService(
    options.embeddingConfig,
    undefined,
    options.storePath,
  );
  await service.initialize();
  return service as IDocumentManagement;
}

/**
 * Creates and initializes a local DocumentManagementService instance.
 * Use this only when constructing an in-process PipelineManager (worker path).
 */
export async function createLocalDocumentManagement(
  embeddingConfig?: EmbeddingModelConfig | null,
  storePath?: string,
) {
  const service = new DocumentManagementService(embeddingConfig, undefined, storePath);
  await service.initialize();
  return service;
}
