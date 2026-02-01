/**
 * End-to-end tests for GitHub private repository scraping.
 *
 * These tests verify that authentication works correctly for private repos.
 * They require GITHUB_TOKEN to be set in the environment (via .env file).
 * If no token is available, tests are skipped gracefully to avoid CI failures.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { createLocalDocumentManagement } from "../src/store";
import { PipelineFactory } from "../src/pipeline/PipelineFactory";
import { EventBusService } from "../src/events";
import { loadConfig } from "../src/utils/config";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";

// Load environment variables from .env file
config();

// Private test repository - intentionally hardcoded for testing
const PRIVATE_REPO_URL = "https://github.com/arabold/private-test-repo";
const PRIVATE_REPO_LIBRARY = "private-test-repo";
const PRIVATE_REPO_VERSION = "1.0.0";

describe("GitHub Private Repository E2E Tests", () => {
  let docService: ReturnType<typeof createLocalDocumentManagement> extends Promise<infer T>
    ? T
    : never;
  let scrapeTool: ScrapeTool;
  let searchTool: SearchTool;
  // biome-ignore lint/suspicious/noExplicitAny: E2E test setup requires flexible typing
  let pipeline: any;
  let tempDir: string;
  const appConfig = loadConfig();

  const hasAuth = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

  beforeAll(async () => {
    if (!hasAuth) {
      console.log(
        "⚠️  Skipping private repo tests - GITHUB_TOKEN not found in environment",
      );
      return;
    }

    // Create temporary directory for test database
    tempDir = mkdtempSync(path.join(tmpdir(), "github-private-repo-e2e-test-"));

    appConfig.app.storePath = tempDir;

    // Initialize services
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
        // Ignore cleanup errors
      }
    }
  });

  it("should successfully scrape a private GitHub repository with auth", async () => {
    if (!hasAuth) {
      console.log("⚠️  Skipping test - no GitHub auth available");
      return;
    }

    // Scrape the private repository and wait for completion
    const result = await scrapeTool.execute({
      library: PRIVATE_REPO_LIBRARY,
      version: PRIVATE_REPO_VERSION,
      url: PRIVATE_REPO_URL,
      options: {
        maxPages: 10,
        maxDepth: 1,
      },
      waitForCompletion: true,
    });

    // Verify scrape completed successfully (returns pagesScraped)
    expect(result).toHaveProperty("pagesScraped");
    expect((result as { pagesScraped: number }).pagesScraped).toBeGreaterThan(0);
  }, 60000);

  it("should be able to search content from the private repository", async () => {
    if (!hasAuth) {
      console.log("⚠️  Skipping test - no GitHub auth available");
      return;
    }

    // Search for content in the scraped private repo
    const result = await searchTool.execute({
      library: PRIVATE_REPO_LIBRARY,
      query: "README",
    });

    // Verify we got results (SearchToolResult has results array)
    expect(result.results.length).toBeGreaterThan(0);
  }, 30000);
});
