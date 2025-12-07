import type { EventBusService } from "../events";
import type { AppConfig } from "../utils/config";
import { DocumentManagementClient } from "./DocumentManagementClient";
import { DocumentManagementService } from "./DocumentManagementService";
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
  appConfig: AppConfig;
}) {
  if (options.serverUrl) {
    const client = new DocumentManagementClient(options.serverUrl);
    await client.initialize();
    return client as IDocumentManagement;
  }

  const storePath = options.appConfig.app.storePath;
  if (!storePath) {
    throw new Error("storePath is required when not using a remote server");
  }

  const service = new DocumentManagementService(options.eventBus, options.appConfig);
  await service.initialize();
  return service as IDocumentManagement;
}

/**
 * Creates and initializes a local DocumentManagementService instance.
 * Use this only when constructing an in-process PipelineManager (worker path).
 */
export async function createLocalDocumentManagement(
  eventBus: EventBusService,
  appConfig: AppConfig,
) {
  const storePath = appConfig.app.storePath;
  if (!storePath) {
    throw new Error("storePath is required when not using a remote server");
  }

  const service = new DocumentManagementService(eventBus, appConfig);
  await service.initialize();
  return service;
}
