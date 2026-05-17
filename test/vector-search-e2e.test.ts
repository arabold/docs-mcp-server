/**
 * End-to-end vector search tests that verify the complete pipeline:
 * scraping -> splitting -> embedding -> indexing -> searching
 * 
 * This test uses the actual services (not mocks) with an in-memory database
 * to validate that vector search works correctly from end to end.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "path";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { config } from "dotenv";
import { PipelineFactory } from "../src/pipeline/PipelineFactory";
import { createLocalDocumentManagement } from "../src/store";
import {
  EmbeddingConfig,
  type EmbeddingModelConfig,
} from "../src/store/embeddings/EmbeddingConfig";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";
import { EventBusService } from "../src/events";
import { loadConfig } from "../src/utils/config";

// Load environment variables from .env file
config();

describe("Vector Search End-to-End Tests", () => {
  let docService: any;
  let scrapeTool: ScrapeTool;
  let searchTool: SearchTool;
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

    // Create temporary directory for test database
    tempDir = mkdtempSync(path.join(tmpdir(), "vector-search-e2e-test-"));

    // Create explicit embedding configuration
    const embeddingConfig: EmbeddingModelConfig = EmbeddingConfig.parseEmbeddingConfig(
      "openai:text-embedding-3-small",
    );

    appConfig.app.storePath = tempDir;
    appConfig.app.embeddingModel = embeddingConfig.modelSpec;
    appConfig.embeddings.vectorDimension = 1536;
    appConfig.scraper.security.fileAccess.mode = "allowedRoots";
    appConfig.scraper.security.fileAccess.allowedRoots = [process.cwd()];

    // Initialize DocumentManagementService with temporary directory and embedding config
    const eventBus = new EventBusService();
    docService = await createLocalDocumentManagement(eventBus, appConfig);

    // Create pipeline for ScrapeTool
    pipeline = await PipelineFactory.createPipeline(docService, eventBus, {
      appConfig: appConfig,
    });
    await pipeline.start();

    // Initialize tools
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

  it("should scrape local README.md and make it searchable", async () => {
    // Get the path to the README.md file
    const readmePath = path.resolve(process.cwd(), "README.md");
    const fileUrl = `file://${readmePath}`;

    // Step 1: Scrape the README.md file
    console.log("📄 Scraping README.md file...");
    const scrapeResult = await scrapeTool.execute({
      library: "test-library",
      version: "1.0.0",
      url: fileUrl,
      waitForCompletion: true,
    });

    // Verify scraping completed successfully
    expect(scrapeResult).toHaveProperty("pagesScraped");
    expect((scrapeResult as any).pagesScraped).toBeGreaterThan(0);

    // Step 2: Verify documents were added to the store
    const exists = await docService.exists("test-library", "1.0.0");
    expect(exists).toBe(true);

    // Step 3: Search for a specific string from the README
    console.log("🔍 Searching for specific content...");
    const searchQuery = "Fetches documentation directly from official sources";
    const searchResult = await searchTool.execute({
      library: "test-library",
      version: "1.0.0",
      query: searchQuery,
      limit: 5,
    });

    // Verify search results
    expect(searchResult.results).toBeDefined();
    expect(Array.isArray(searchResult.results)).toBe(true);
    expect(searchResult.results.length).toBeGreaterThan(0);

    // Verify that at least one result contains the expected content
    const hasExpectedContent = searchResult.results.some((result) =>
      result.content.toLowerCase().includes("fetches documentation directly"),
    );
    expect(hasExpectedContent).toBe(true);

    console.log(`✅ Found ${searchResult.results.length} search results`);
    const firstScore = searchResult.results[0].score;
    console.log(`📊 First result score: ${firstScore !== null ? firstScore : 'N/A'}`);

    // Step 4: Test with a broader search to verify improved vector search
    console.log("🔍 Testing broader search capabilities...");
    const broadSearchResult = await searchTool.execute({
      library: "test-library",
      version: "1.0.0",
      query: "documentation MCP server",
      limit: 10,
    });

    expect(broadSearchResult.results.length).toBeGreaterThan(0);

    // With the vector search multiplier, we should find more diverse results
    broadSearchResult.results.forEach((result) => {
      const score = result.score !== null ? result.score.toFixed(4) : "N/A";
    });
  }, 60000);

  it("should handle version-specific searches", async () => {
    // Search with exact version match
    const searchResult = await searchTool.execute({
      library: "test-library",
      version: "1.0.0",
      query: "MCP server",
      exactMatch: true,
      limit: 3,
    });

    expect(searchResult.results).toBeDefined();
    expect(searchResult.results.length).toBeGreaterThan(0);

    // Verify results contain MCP-related content
    const hasMcpContent = searchResult.results.some((result) =>
      result.content.toLowerCase().includes("mcp"),
    );
    expect(hasMcpContent).toBe(true);
  }, 30000);

  it("should find semantic similarities beyond exact text matches", async () => {
    // Search for a concept that should match semantically
    const searchResult = await searchTool.execute({
      library: "test-library",
      version: "1.0.0",
      query: "artificial intelligence documentation helper",
      limit: 5,
    });

    expect(searchResult.results).toBeDefined();
    expect(searchResult.results.length).toBeGreaterThan(0);

    // Log results for manual inspection of semantic matching
    searchResult.results.forEach((result, index) => {
      const score = result.score !== null ? result.score.toFixed(3) : "N/A";
      console.log(
        `  ${index + 1}. Score: ${score} - ${result.content.substring(0, 100)}...`,
      );
    });
  }, 30000);

  it("should handle non-existent library searches gracefully", async () => {
    await expect(
      searchTool.execute({
        library: "non-existent-library",
        version: "1.0.0",
        query: "test query",
      }),
    ).rejects.toThrow(
      "Library non-existent-library not found in store. Did you mean: test-library?",
    );
  }, 10000);

  it("should handle non-existent version searches gracefully", async () => {
    // Search for a non-existent version should return empty results
    const searchResult = await searchTool.execute({
      library: "test-library",
      version: "999.999.999",
      query: "test query",
      exactMatch: true,
    });

    expect(searchResult.results).toBeDefined();
    expect(Array.isArray(searchResult.results)).toBe(true);
    expect(searchResult.results.length).toBe(0);
  }, 10000);
});
