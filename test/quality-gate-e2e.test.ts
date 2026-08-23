/**
 * End-to-end quality-gate test that verifies the gate-then-rollback behavior:
 * a scrape that indexes nothing must finish FAILED with errorCode EMPTY_RESULT
 * and must leave nothing searchable (the staged version is rolled back).
 *
 * Modeled on test/vector-search-e2e.test.ts (in-process pipeline + MSW-mocked
 * OpenAI embeddings). Uses a local fixture directory containing only a
 * non-indexable file so the crawl finishes with zero stored chunks.
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { PipelineFactory } from "../src/pipeline/PipelineFactory";
import { PipelineJobStatus, ScrapeErrorCode, ScrapeOutcome } from "../src/pipeline/types";
import { createLocalDocumentManagement } from "../src/store";
import {
  EmbeddingConfig,
  type EmbeddingModelConfig,
} from "../src/store/embeddings/EmbeddingConfig";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";
import { loadConfig } from "../src/utils/config";

// Load environment variables from .env file
config();

describe("Quality Gate End-to-End Tests", () => {
  // biome-ignore lint/suspicious/noExplicitAny: test harness mirrors vector-search-e2e
  let docService: any;
  let scrapeTool: ScrapeTool;
  let searchTool: SearchTool;
  // biome-ignore lint/suspicious/noExplicitAny: test harness mirrors vector-search-e2e
  let pipeline: any;
  let tempDir: string;
  const appConfig = loadConfig();
  let prevOpenAiApiKey: string | undefined;
  let prevOpenAiApiBase: string | undefined;

  beforeAll(async () => {
    // Ensure vector search initializes in tests without requiring real credentials.
    // The OpenAI embeddings endpoint is mocked by test/mock-server.ts.
    prevOpenAiApiKey = process.env.OPENAI_API_KEY;
    prevOpenAiApiBase = process.env.OPENAI_API_BASE;
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.OPENAI_API_BASE;

    tempDir = mkdtempSync(path.join(tmpdir(), "quality-gate-e2e-test-"));

    const embeddingConfig: EmbeddingModelConfig = EmbeddingConfig.parseEmbeddingConfig(
      "openai:text-embedding-3-small",
    );

    appConfig.app.storePath = tempDir;
    appConfig.app.embeddingModel = embeddingConfig.modelSpec;
    appConfig.embeddings.vectorDimension = 1536;
    appConfig.scraper.security.fileAccess.mode = "allowedRoots";
    appConfig.scraper.security.fileAccess.allowedRoots = [process.cwd()];

    const eventBus = new EventBusService();
    docService = await createLocalDocumentManagement(eventBus, appConfig);

    pipeline = await PipelineFactory.createPipeline(docService, eventBus, {
      appConfig: appConfig,
    });
    await pipeline.start();

    scrapeTool = new ScrapeTool(pipeline, appConfig.scraper);
    searchTool = new SearchTool(docService);
  }, 30000);

  afterAll(async () => {
    try {
      if (pipeline) {
        await pipeline.stop();
      }
      if (docService) {
        await docService.shutdown();
      }
      if (tempDir) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } finally {
      if (prevOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevOpenAiApiKey;
      }

      if (prevOpenAiApiBase === undefined) {
        delete process.env.OPENAI_API_BASE;
      } else {
        process.env.OPENAI_API_BASE = prevOpenAiApiBase;
      }
    }
  });

  it("a scrape that indexes nothing is not searchable and reports EMPTY_RESULT", async () => {
    const fixtureDir = path.resolve(process.cwd(), "test/fixtures/empty-fixture");
    const fileUrl = `file://${fixtureDir}`;

    // Enqueue without waiting; a gate failure rejects the completion promise.
    const result = await scrapeTool.execute({
      library: "emptylib",
      version: "1.0.0",
      url: fileUrl,
      waitForCompletion: false,
    });
    const jobId = (result as { jobId: string }).jobId;

    // The gate failure rejects waitForJobCompletion; swallow it and inspect state.
    await pipeline.waitForJobCompletion(jobId).catch(() => {});

    const job = await pipeline.getJob(jobId);
    expect(job?.status).toBe(PipelineJobStatus.FAILED);
    expect(job?.outcome).toBe(ScrapeOutcome.EMPTY);
    expect(job?.errorCode).toBe(ScrapeErrorCode.EMPTY_RESULT);

    // Rolled back: nothing should be searchable for this (library, version).
    const searchResult = await searchTool.execute({
      library: "emptylib",
      version: "1.0.0",
      query: "anything",
      exactMatch: true,
    });
    expect(searchResult.results).toHaveLength(0);
  }, 60000);
});
