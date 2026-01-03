/**
 * Refresh command - Re-scrapes an existing library version using ETags to skip unchanged pages.
 */

import type { Argv } from "yargs";
import { EventType } from "../../events";
import { PipelineFactory, PipelineJobStatus, type PipelineOptions } from "../../pipeline";
import type { IPipeline } from "../../pipeline/trpc/interfaces";
import { createDocumentManagement, type DocumentManagementService } from "../../store";
import type { IDocumentManagement } from "../../store/trpc/interfaces";
import { TelemetryEvent, telemetry } from "../../telemetry";
import { RefreshVersionTool } from "../../tools/RefreshVersionTool";
import { loadConfig } from "../../utils/config";
import { type CliContext, getEventBus, resolveEmbeddingContext } from "../utils";

export function createRefreshCommand(cli: Argv) {
  cli.command(
    "refresh <library>",
    "Update an existing library version by re-scraping changed pages",
    (yargs) => {
      return yargs
        .positional("library", {
          type: "string",
          description: "Library name to refresh",
          demandOption: true,
        })
        .option("version", {
          type: "string",
          description: "Version of the library (optional)",
          alias: "v",
        })
        .option("embedding-model", {
          type: "string",
          description:
            "Embedding model configuration (e.g., 'openai:text-embedding-3-small')",
          alias: "embeddingModel",
        })
        .option("server-url", {
          type: "string",
          description:
            "URL of external pipeline worker RPC (e.g., http://localhost:8080/api)",
          alias: "serverUrl",
        })
        .usage(
          "$0 refresh <library> [options]\n\n" +
            "Uses HTTP ETags to efficiently skip unchanged pages and only re-process\n" +
            "content that has been modified or deleted since the last scrape.\n\n" +
            "Examples:\n" +
            "  refresh react --version 18.0.0\n" +
            "  refresh mylib\n" +
            "\nNote: The library and version must already be indexed. Use 'scrape' to index a new library/version.",
        );
    },
    async (argv) => {
      await telemetry.track(TelemetryEvent.CLI_COMMAND, {
        command: "refresh",
        library: argv.library,
        version: argv.version,
        useServerUrl: !!argv.serverUrl,
      });

      const library = argv.library as string;
      const version = argv.version as string | undefined;
      const serverUrl = argv.serverUrl as string | undefined;

      const appConfig = loadConfig(argv, {
        configPath: argv.config as string,
        searchDir: argv.storePath as string,
      });

      //Resolve embedding configuration for local execution (refresh needs embeddings)
      const embeddingConfig = resolveEmbeddingContext(appConfig.app.embeddingModel);
      if (!serverUrl && !embeddingConfig) {
        throw new Error(
          "Embedding configuration is required for local refresh operations. " +
            "Please set DOCS_MCP_EMBEDDING_MODEL environment variable or use --server-url for remote execution.",
        );
      }

      const eventBus = getEventBus(argv as CliContext);

      const docService: IDocumentManagement = await createDocumentManagement({
        serverUrl,
        eventBus,
        appConfig: appConfig,
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
          serverUrl,
          appConfig: appConfig,
        };

        pipeline = serverUrl
          ? await PipelineFactory.createPipeline(undefined, eventBus, {
              serverUrl,
              ...pipelineOptions,
            })
          : await PipelineFactory.createPipeline(
              docService as DocumentManagementService,
              eventBus,
              pipelineOptions,
            );

        await pipeline.start();
        const refreshTool = new RefreshVersionTool(pipeline);

        // Call the tool directly - tracking is now handled inside the tool
        const result = await refreshTool.execute({
          library,
          version,
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
    },
  );
}
