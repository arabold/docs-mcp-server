/**
 * Refresh command - Re-scrapes an existing library version using ETags to skip unchanged pages.
 */

import type { Command } from "commander";
import { Option } from "commander";
import { EventType } from "../../events";
import { PipelineFactory, PipelineJobStatus, type PipelineOptions } from "../../pipeline";
import type { IPipeline } from "../../pipeline/trpc/interfaces";
import { createDocumentManagement } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { analytics, TelemetryEvent } from "../../telemetry";
import { RefreshVersionTool } from "../../tools/RefreshVersionTool";
import { getEventBus, getGlobalOptions, resolveEmbeddingContext } from "../utils";

export async function refreshAction(
  library: string,
  options: {
    version?: string;
    embeddingModel?: string;
    serverUrl?: string;
  },
  command?: Command,
) {
  await analytics.track(TelemetryEvent.CLI_COMMAND, {
    command: "refresh",
    library,
    version: options.version,
    useServerUrl: !!options.serverUrl,
  });

  const serverUrl = options.serverUrl;
  const globalOptions = getGlobalOptions(command);

  // Resolve embedding configuration for local execution (refresh needs embeddings)
  const embeddingConfig = resolveEmbeddingContext(options.embeddingModel);
  if (!serverUrl && !embeddingConfig) {
    throw new Error(
      "Embedding configuration is required for local refresh operations. " +
        "Please set DOCS_MCP_EMBEDDING_MODEL environment variable or use --server-url for remote execution.",
    );
  }

  const eventBus = getEventBus(command);

  const docService: IDocumentManagement = await createDocumentManagement({
    serverUrl,
    embeddingConfig,
    storePath: globalOptions.storePath,
    eventBus,
  });
  let pipeline: IPipeline | null = null;

  // Display initial status
  console.log("⏳ Initializing refresh job...");

  // Subscribe to event bus for progress updates (only for local pipelines)
  let unsubscribeProgress: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;

  if (!serverUrl) {
    unsubscribeProgress = eventBus.on(EventType.JOB_PROGRESS, (event) => {
      const { job, progress } = event;
      console.log(
        `📄 Refreshing ${job.library}${job.version ? ` v${job.version}` : ""}: ${progress.pagesScraped}/${progress.totalPages} pages`,
      );
    });

    unsubscribeStatus = eventBus.on(EventType.JOB_STATUS_CHANGE, (event) => {
      if (event.status === PipelineJobStatus.RUNNING) {
        console.log(
          `🚀 Refreshing ${event.library}${event.version ? ` v${event.version}` : ""}...`,
        );
      }
    });
  }

  try {
    const pipelineOptions: PipelineOptions = {
      recoverJobs: false,
      concurrency: 1,
      serverUrl,
    };

    pipeline = serverUrl
      ? await PipelineFactory.createPipeline(undefined, undefined, {
          serverUrl,
          ...pipelineOptions,
        })
      : await PipelineFactory.createPipeline(
          docService as unknown as never,
          eventBus,
          pipelineOptions,
        );

    await pipeline.start();
    const refreshTool = new RefreshVersionTool(pipeline);

    // Call the tool directly - tracking is now handled inside the tool
    const result = await refreshTool.execute({
      library,
      version: options.version,
      waitForCompletion: true, // Always wait for completion in CLI
    });

    if ("pagesRefreshed" in result) {
      console.log(`✅ Successfully refreshed ${result.pagesRefreshed} pages`);
    } else {
      console.log(`✅ Refresh job started with ID: ${result.jobId}`);
    }
  } catch (error) {
    console.error(
      `❌ Refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    // Clean up event listeners
    if (unsubscribeProgress) unsubscribeProgress();
    if (unsubscribeStatus) unsubscribeStatus();

    if (pipeline) await pipeline.stop();
    await docService.shutdown();
  }
}

export function createRefreshCommand(program: Command): Command {
  return program
    .command("refresh <library>")
    .description(
      "Re-scrape an existing library version, updating only changed pages.\n\n" +
        "Uses HTTP ETags to efficiently skip unchanged pages and only re-process\n" +
        "content that has been modified or deleted since the last scrape.\n\n" +
        "Examples:\n" +
        "  refresh react --version 18.0.0\n" +
        "  refresh mylib\n" +
        "\nNote: The library and version must already be indexed. Use 'scrape' to index a new library/version.",
    )
    .option("-v, --version <string>", "Version of the library (optional)")
    .addOption(
      new Option(
        "--embedding-model <model>",
        "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
      ).env("DOCS_MCP_EMBEDDING_MODEL"),
    )
    .option(
      "--server-url <url>",
      "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
    )
    .action(refreshAction);
}
