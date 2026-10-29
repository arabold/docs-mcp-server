/**
 * The services an entry point runs on: document management, an optional
 * pipeline and the event bus, either in this process or on a remote worker.
 *
 * Every CLI command and server opens its services here, so local and remote
 * runs get the same guarantees: a remote backend relays the worker's events to
 * the local bus, and the backend owns starting and stopping what it created.
 */

import type { EventBusService } from "../events";
import { RemoteEventProxy } from "../events/RemoteEventProxy";
import { EVENTS_CONNECT_TIMEOUT_MS, PipelineClient } from "../pipeline/PipelineClient";
import { PipelineManager } from "../pipeline/PipelineManager";
import type { IPipeline } from "../pipeline/trpc/interfaces";
import type { InterruptedJobs } from "../pipeline/types";
import { DocumentManagementClient } from "../store/DocumentManagementClient";
import { DocumentManagementService } from "../store/DocumentManagementService";
import { EmbeddingModelChangedError } from "../store/errors";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { TelemetryService } from "../telemetry/TelemetryService";
import type { AppConfig } from "../utils/config";
import { logger } from "../utils/logger";
import { createApiClient, pingApi } from "./apiClient";

/**
 * How much of the pipeline a caller needs:
 * - `false`: documents only; no pipeline, and no WebSocket to a worker. A local
 *   backend starts no pipeline, so it never interrupts jobs that another
 *   process runs on the same store.
 * - `{ interruptedJobs }`: run jobs. Locally a started pipeline that handles
 *   the jobs an earlier run left unfinished as asked (see {@link InterruptedJobs});
 *   remotely the worker's pipeline (the worker handles its own, so
 *   `interruptedJobs` does not apply).
 */
export type BackendJobs = false | { interruptedJobs: InterruptedJobs };

/** Options for {@link openBackend}. */
export interface OpenBackendOptions {
  appConfig: AppConfig;
  eventBus: EventBusService;
  /** The remote worker's API URL; the backend is local without it. */
  serverUrl?: string;
  /** How much of the pipeline is needed. Defaults to `false`. */
  jobs?: BackendJobs;
  /**
   * Handles a changed embedding model when the local store opens. Without it,
   * the error propagates.
   */
  onEmbeddingModelChange?: (
    error: EmbeddingModelChangedError,
    service: DocumentManagementService,
  ) => Promise<void>;
}

/** Services opened by {@link openBackend}. */
export interface Backend {
  /** The worker's API URL for a remote backend; undefined for a local one. */
  readonly workerUrl: string | undefined;
  readonly docService: IDocumentManagement;
  /** The pipeline, when `jobs` asked for one that this backend can provide. */
  readonly pipeline: IPipeline | undefined;
  readonly eventBus: EventBusService;
  /** Whether the worker's events reach the bus; only for a remote backend with a pipeline. */
  readonly isWorkerConnected: (() => boolean) | undefined;
  /**
   * Stops everything the backend started, in reverse order. Runs every step
   * even when one fails, logs each failure, and rejects with the first. Later
   * calls return the first call's result.
   */
  close(): Promise<void>;
}

/** A backend that runs jobs, as servers need it. */
export interface JobsBackend extends Backend {
  readonly pipeline: IPipeline;
}

/**
 * Opens the services for an entry point, local or on the worker at
 * `serverUrl`. A remote backend that has a pipeline starts relaying the
 * worker's events in the background; job submission waits briefly for it.
 *
 * @throws Error when the worker does not answer, or the local store fails to
 *   open. Whatever was opened before the failure is closed first.
 */
export function openBackend(
  options: OpenBackendOptions & { jobs: { interruptedJobs: InterruptedJobs } },
): Promise<JobsBackend>;
export function openBackend(options: OpenBackendOptions): Promise<Backend>;
export async function openBackend(options: OpenBackendOptions): Promise<Backend> {
  const closer = new Closer();
  try {
    return options.serverUrl
      ? await openRemote(options, options.serverUrl, closer)
      : await openLocal(options, closer);
  } catch (error) {
    await closer.close().catch(() => {});
    throw error;
  }
}

async function openLocal(options: OpenBackendOptions, closer: Closer): Promise<Backend> {
  const { appConfig, eventBus, jobs = false } = options;
  if (!appConfig.app.storePath) {
    throw new Error("storePath is required when not using a remote server");
  }

  const docService = new DocumentManagementService(eventBus, appConfig);
  closer.add(() => docService.shutdown());
  try {
    await docService.initialize();
  } catch (error) {
    if (
      !(error instanceof EmbeddingModelChangedError) ||
      !options.onEmbeddingModelChange
    ) {
      throw error;
    }
    await options.onEmbeddingModelChange(error, docService);
  }

  let pipeline: IPipeline | undefined;
  if (jobs) {
    // Reports the jobs this process runs, from the first one recovered on start
    const jobTelemetry = new TelemetryService(eventBus);
    closer.add(() => jobTelemetry.shutdown());
    const manager = new PipelineManager(docService, eventBus, {
      interruptedJobs: jobs.interruptedJobs,
      appConfig,
    });
    await manager.start();
    closer.add(() => manager.stop());
    pipeline = manager;
  }

  return {
    workerUrl: undefined,
    docService,
    pipeline,
    eventBus,
    isWorkerConnected: undefined,
    close: () => closer.close(),
  };
}

async function openRemote(
  options: OpenBackendOptions,
  workerUrl: string,
  closer: Closer,
): Promise<Backend> {
  const { eventBus, jobs = false } = options;
  const withPipeline = jobs !== false;

  const { api, close } = createApiClient(workerUrl, {
    subscriptions: withPipeline,
    headers: (): Record<string, string> =>
      options.appConfig.auth.adminToken
        ? { authorization: `Bearer ${options.appConfig.auth.adminToken}` }
        : {},
  });
  closer.add(close);
  await pingApi(api, workerUrl);
  const docService = new DocumentManagementClient(api);

  let pipeline: IPipeline | undefined;
  let isWorkerConnected: (() => boolean) | undefined;
  if (withPipeline) {
    const relay = new RemoteEventProxy(api, eventBus);
    closer.add(() => relay.disconnect());
    pipeline = new PipelineClient(api, eventBus, relay);
    isWorkerConnected = () => relay.isActive();
    // Connect in the background; submitting a job waits for this attempt.
    void relay.connect(EVENTS_CONNECT_TIMEOUT_MS);
  }

  return {
    workerUrl,
    docService,
    pipeline,
    eventBus,
    isWorkerConnected,
    close: () => closer.close(),
  };
}

/** Collects close steps and runs them once, in reverse order. */
class Closer {
  private readonly steps: Array<() => void | Promise<void>> = [];
  private closing: Promise<void> | undefined;

  add(step: () => void | Promise<void>): void {
    this.steps.push(step);
  }

  close(): Promise<void> {
    this.closing ??= this.runSteps();
    return this.closing;
  }

  private async runSteps(): Promise<void> {
    let firstError: unknown;
    for (const step of [...this.steps].reverse()) {
      try {
        await step();
      } catch (error) {
        logger.error(`❌ Failed to close a backend service: ${error}`);
        firstError ??= error;
      }
    }
    if (firstError !== undefined) {
      throw firstError;
    }
  }
}
