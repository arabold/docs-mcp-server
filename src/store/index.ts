import type { EventBusService } from "../events";
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
export async function createDocumentManagement(options: {
  eventBus: EventBusService;
  serverUrl?: string;
  embeddingConfig?: EmbeddingModelConfig | null;
  storePath?: string;
}) {
  if (options.serverUrl) {
    const client = new DocumentManagementClient(options.serverUrl);
    await client.initialize();
    return client as IDocumentManagement;
  }
  if (!options.storePath) {
    throw new Error("storePath is required when not using a remote server");
  }
  const service = new DocumentManagementService(
    options.storePath,
    options.eventBus,
    options.embeddingConfig,
    undefined,
  );
  await service.initialize();
  return service as IDocumentManagement;
}

/**
 * Creates and initializes a local DocumentManagementService instance.
 * Use this only when constructing an in-process PipelineManager (worker path).
 */
export async function createLocalDocumentManagement(
  storePath: string,
  eventBus: EventBusService,
  embeddingConfig?: EmbeddingModelConfig | null,
) {
  const service = new DocumentManagementService(
    storePath,
    eventBus,
    embeddingConfig,
    undefined,
  );
  await service.initialize();
  return service;
}
