/**
 * End-to-end tests for GitHub private repository scraping.
 *
 * These tests verify that authentication works correctly for private repos.
 * They require GITHUB_TOKEN (or GH_TOKEN) in the environment or the .env file;
 * without one the suite is reported as skipped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { type Backend, openBackend } from "../src/services/backend";
import { EventBusService } from "../src/events";
import { loadConfig } from "../src/utils/config";
import { type ScrapeExecuteResult, ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";
import { allowLiveNetwork } from "./mock-server";

// Load environment variables from .env file
config();

// Private test repository - intentionally hardcoded for testing
const PRIVATE_REPO_URL = "https://github.com/arabold/private-test-repo";
const PRIVATE_REPO_LIBRARY = "private-test-repo";
const PRIVATE_REPO_VERSION = "1.0.0";

const hasAuth = !!(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);

describe.skipIf(!hasAuth)("GitHub Private Repository E2E Tests", () => {
  let backend: Backend | undefined;
  let searchTool: SearchTool;
  let scrapeResult: ScrapeExecuteResult;
  let tempDir: string | undefined;
  let releaseNetwork = (): void => {};

  // Scrape the private repository once; the tests check the outcome
  beforeAll(async () => {
    // These tests read a real private repository on GitHub.
    releaseNetwork = allowLiveNetwork();

    // Create temporary directory for test database
    tempDir = mkdtempSync(path.join(tmpdir(), "github-private-repo-e2e-test-"));

    const appConfig = loadConfig();
    appConfig.app.storePath = tempDir;
    appConfig.app.embeddingModel = "";

    // Initialize services
    const eventBus = new EventBusService();
    backend = await openBackend({ appConfig, eventBus, jobs: { interruptedJobs: "fail" } });
    searchTool = new SearchTool(backend.docService);
    if (!backend.pipeline) {
      throw new Error("The backend opened without a pipeline");
    }

    scrapeResult = await new ScrapeTool(backend.pipeline, appConfig.scraper).execute({
      library: PRIVATE_REPO_LIBRARY,
      version: PRIVATE_REPO_VERSION,
      url: PRIVATE_REPO_URL,
      options: {
        maxPages: 10,
        maxDepth: 1,
      },
      waitForCompletion: true,
    });
  }, 90000);

  afterAll(async () => {
    releaseNetwork();
    await backend?.close();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should successfully scrape a private GitHub repository with auth", () => {
    // Verify scrape completed successfully (returns pagesScraped)
    expect(scrapeResult).toHaveProperty("pagesScraped");
    expect((scrapeResult as { pagesScraped: number }).pagesScraped).toBeGreaterThan(0);
  });

  it("should be able to search content from the private repository", async () => {
    // Search for content in the scraped private repo
    const result = await searchTool.execute({
      library: PRIVATE_REPO_LIBRARY,
      query: "README",
    });

    // Verify we got results (SearchToolResult has results array)
    expect(result.results.length).toBeGreaterThan(0);
  }, 30000);
});
