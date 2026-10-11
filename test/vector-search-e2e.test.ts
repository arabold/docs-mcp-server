/**
 * End-to-end tests for vector search: scrape -> split -> embed -> index -> search.
 *
 * Runs the real pipeline and store against a temporary SQLite database. The
 * OpenAI embeddings endpoint is answered by `test/mock-server.ts`, which embeds
 * text as hashed character trigrams: deterministic, and close for texts that
 * share words or parts of words.
 *
 * `beforeAll` indexes a few small Markdown pages once. Every test only reads.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import {
  createLocalDocumentManagement,
  type DocumentManagementService,
  LibraryNotFoundInStoreError,
} from "../src/store";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";
import { loadConfig } from "../src/utils/config";

const LIBRARY = "search-fixtures";
const VERSION = "1.0.0";

/** The pages the suite indexes, one topic each. */
const PAGES: Record<string, string> = {
  "authentication.md": [
    "# Authentication",
    "",
    "Every request must carry an API token in the Authorization header. Tokens",
    "are created on the account settings page and can be revoked at any time.",
    "Requests without a valid token are rejected with status 401.",
  ].join("\n"),
  "caching.md": [
    "# Caching",
    "",
    "Responses are cached for five minutes. Send Cache-Control: no-cache to",
    "bypass the cache, or call the purge endpoint to invalidate every cached",
    "entry at once.",
  ].join("\n"),
  "deployment.md": [
    "# Deployment",
    "",
    "Build the container image from the provided Dockerfile and run it behind a",
    "reverse proxy. Set the PORT environment variable to change the port the",
    "server listens on.",
  ].join("\n"),
};

describe("Vector search E2E", () => {
  let tempDir: string;
  /** `file://` URL of the directory the pages are written to. */
  let docsUrl: string;
  let docService: DocumentManagementService;
  let pipeline: PipelineManager;
  let searchTool: SearchTool;

  beforeAll(async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_API_BASE", undefined);

    // realpath, because the file access policy refuses symlinked paths and the
    // macOS temp dir sits behind one (/var -> /private/var).
    tempDir = mkdtempSync(path.join(realpathSync(tmpdir()), "vector-search-e2e-"));
    const docsDir = path.join(tempDir, "docs");
    mkdirSync(docsDir);
    for (const [name, content] of Object.entries(PAGES)) {
      writeFileSync(path.join(docsDir, name), content);
    }
    docsUrl = `file://${docsDir}`;

    const appConfig = loadConfig();
    appConfig.app.storePath = tempDir;
    appConfig.app.embeddingModel = "openai:text-embedding-3-small";
    appConfig.scraper.security.fileAccess.allowedRoots = [docsDir];

    const eventBus = new EventBusService();
    docService = await createLocalDocumentManagement(eventBus, appConfig);
    pipeline = new PipelineManager(docService, eventBus, {
      recoverJobs: false,
      appConfig,
    });
    await pipeline.start();

    await new ScrapeTool(pipeline, appConfig.scraper).execute({
      library: LIBRARY,
      version: VERSION,
      url: docsUrl,
      waitForCompletion: true,
    });

    searchTool = new SearchTool(docService);
  });

  afterAll(async () => {
    await pipeline?.stop();
    await docService?.shutdown();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it("stores one vector for every embedded chunk", () => {
    const db = new Database(path.join(tempDir, "documents.db"), { readonly: true });
    try {
      sqliteVec.load(db);
      const { chunkCount } = db
        .prepare(
          "SELECT COUNT(*) AS chunkCount FROM documents WHERE embedding IS NOT NULL",
        )
        .get() as { chunkCount: number };
      const { vectorCount } = db
        .prepare("SELECT COUNT(*) AS vectorCount FROM documents_vec")
        .get() as { vectorCount: number };

      expect(chunkCount).toBeGreaterThan(0);
      expect(vectorCount).toBe(chunkCount);
    } finally {
      db.close();
    }
  });

  it("returns the page that contains a phrase from its text", async () => {
    const { results } = await searchTool.execute({
      library: LIBRARY,
      version: VERSION,
      query: "revoked at any time",
    });

    expect(results[0]?.url).toBe(`${docsUrl}/authentication.md`);
    expect(results[0]?.content).toContain("revoked at any time");
  });

  it("finds pages for a query that matches no keyword", async () => {
    // Every word is misspelled, so full-text search matches nothing and only
    // the vector side of the hybrid search can return a page.
    const { results } = await searchTool.execute({
      library: LIBRARY,
      version: VERSION,
      query: "autentication tokn",
    });

    expect(results).not.toEqual([]);
  });

  // Blocked: rows full-text search did not match still get an FTS rank (by row order).
  it.todo("ranks the closest page first for a query that matches no keyword");

  it("searches an indexed version when exactMatch is set", async () => {
    const { results } = await searchTool.execute({
      library: LIBRARY,
      version: VERSION,
      query: "reverse proxy",
      exactMatch: true,
    });

    expect(results[0]?.url).toBe(`${docsUrl}/deployment.md`);
  });

  it("returns no results for an exact version that is not indexed", async () => {
    const { results } = await searchTool.execute({
      library: LIBRARY,
      version: "999.999.999",
      query: "reverse proxy",
      exactMatch: true,
    });

    expect(results).toEqual([]);
  });

  it("suggests the closest library name when the library is unknown", async () => {
    await expect(
      searchTool.execute({ library: "search-fixture", query: "reverse proxy" }),
    ).rejects.toThrow(new LibraryNotFoundInStoreError("search-fixture", [LIBRARY]));
  });
});
