import type { EventBusService } from "../events";
import type { AppConfig } from "../utils/config";
import { CircuitBreakingReranker } from "./CircuitBreakingReranker";
import { DocumentManagementClient } from "./DocumentManagementClient";
import { DocumentManagementService } from "./DocumentManagementService";
import type { Reranker } from "./Reranker";
import type { IDocumentManagement } from "./trpc/interfaces";
import { VoyageReranker } from "./VoyageReranker";

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

  const service = createLocalDocumentManagementService(
    options.eventBus,
    options.appConfig,
  );
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

  const service = createLocalDocumentManagementService(eventBus, appConfig);
  await service.initialize();
  return service;
}

/**
 * Creates the local search-executing service and injects its optional Reranker.
 * @param eventBus Local application event bus.
 * @param appConfig Resolved non-secret application configuration.
 * @returns An uninitialized local document management service.
 */
export function createLocalDocumentManagementService(
  eventBus: EventBusService,
  appConfig: AppConfig,
): DocumentManagementService {
  return new DocumentManagementService(
    eventBus,
    appConfig,
    createLocalReranker(appConfig),
  );
}

function createLocalReranker(appConfig: AppConfig): Reranker | undefined {
  if (!appConfig.search.reranker.enabled) {
    return undefined;
  }

  const apiKey = process.env.VOYAGE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing required environment variable: VOYAGE_API_KEY");
  }

  return new CircuitBreakingReranker(
    new VoyageReranker({
      apiKey,
      model: appConfig.search.reranker.model,
      requestTimeoutMs: appConfig.search.reranker.requestTimeoutMs,
    }),
  );
}
