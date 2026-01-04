/**
 * Ensures embeddings are persisted into the documents_vec virtual table.
 *
 * This test is self-contained:
 * - Uses a temporary SQLite database (storePath points to a temp dir)
 * - Uses MSW to mock OpenAI embeddings so it does not require network access
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { config } from "dotenv";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { createLocalDocumentManagement } from "../src/store";
import { PipelineFactory } from "../src/pipeline/PipelineFactory";
import {
  EmbeddingConfig,
  type EmbeddingModelConfig,
} from "../src/store/embeddings/EmbeddingConfig";
import { EventBusService } from "../src/events";
import { loadConfig } from "../src/utils/config";

config();

describe("Vector persistence", () => {
  let tempDir: string;
  let pipeline: any;
  let docService: any;
  let scrapeTool: ScrapeTool;
  const appConfig = loadConfig();

  let prevOpenAiApiKey: string | undefined;
  let prevOpenAiApiBase: string | undefined;

  beforeAll(async () => {
    // Ensure vector search initializes in tests without requiring real credentials.
    prevOpenAiApiKey = process.env.OPENAI_API_KEY;
    prevOpenAiApiBase = process.env.OPENAI_API_BASE;

    process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-key";
    delete process.env.OPENAI_API_BASE;

    tempDir = mkdtempSync(path.join(tmpdir(), "vector-persistence-e2e-"));
    const embeddingConfig: EmbeddingModelConfig = EmbeddingConfig.parseEmbeddingConfig(
      "openai:text-embedding-3-small",
    );

    appConfig.app.storePath = tempDir;
    appConfig.app.embeddingModel = embeddingConfig.modelSpec;

    const eventBus = new EventBusService();
    docService = await createLocalDocumentManagement(eventBus, appConfig);

    pipeline = await PipelineFactory.createPipeline(docService, eventBus, {
      appConfig,
    });
    await pipeline.start();

    scrapeTool = new ScrapeTool(pipeline, appConfig.scraper);
  }, 30000);

  afterAll(async () => {
    if (pipeline) {
      await pipeline.stop();
    }
    if (docService) {
      await docService.shutdown();
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }

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
  });

  it(
    "persists embeddings into documents_vec",
    async () => {
      const readmePath = path.resolve(process.cwd(), "README.md");
      const fileUrl = `file://${readmePath}`;

      await scrapeTool.execute({
        library: "vector-persist-lib",
        version: "1.0.0",
        url: fileUrl,
        waitForCompletion: true,
      });

      const exists = await docService.exists("vector-persist-lib", "1.0.0");
      expect(exists).toBe(true);

      const dbPath = path.join(tempDir, "documents.db");
      const db = new Database(dbPath);
      sqliteVec.load(db);

      const { chunkCount } = db
        .prepare(
          "SELECT COUNT(*) as chunkCount FROM documents WHERE embedding IS NOT NULL",
        )
        .get() as { chunkCount: number };
      expect(chunkCount).toBeGreaterThan(0);

      const { vecCount } = db
        .prepare("SELECT COUNT(*) as vecCount FROM documents_vec")
        .get() as { vecCount: number };
      expect(vecCount).toBeGreaterThan(0);
      expect(vecCount).toBe(chunkCount);
    },
    60000,
  );
});
