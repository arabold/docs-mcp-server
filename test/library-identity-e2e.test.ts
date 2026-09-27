/**
 * End-to-end tests for library identity: display names, case-insensitive
 * matching, and the rules for when indexing may create or overwrite a library
 * or version.
 *
 * Every case runs against a real SQLite store (FTS-only), with a pipeline that
 * is never started: jobs stay QUEUED, so each case observes exactly what an
 * entry point accepted or rejected without scraping anything.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { createMcpServerInstance } from "../src/mcp/mcpServer";
import type { McpServerTools } from "../src/mcp/tools";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { pipelineRouter } from "../src/pipeline/trpc/router";
import type { ScraperOptions, ScrapeResult } from "../src/scraper/types";
import { applyMigrations } from "../src/store/applyMigrations";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import {
  LibraryAlreadyExistsError,
  LibraryNotFoundInStoreError,
  VersionAlreadyExistsError,
  VersionNotFoundInStoreError,
} from "../src/store/errors";
import { VersionStatus } from "../src/store/types";
import { GetJobInfoTool } from "../src/tools/GetJobInfoTool";
import { ListJobsTool } from "../src/tools/ListJobsTool";
import { ListLibrariesTool } from "../src/tools/ListLibrariesTool";
import { RefreshVersionTool } from "../src/tools/RefreshVersionTool";
import { RemoveTool } from "../src/tools/RemoveTool";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";
import { type AppConfig, loadConfig } from "../src/utils/config";
import { restorePre017Libraries } from "./test-helpers";

const DOCS_URL = "https://example.com/docs";

function scrapeResult(url: string, content: string): ScrapeResult {
  return {
    url,
    title: "Doc",
    sourceContentType: "text/html",
    contentType: "text/html",
    textContent: content,
    links: [],
    errors: [],
    chunks: [{ types: ["text"], content, section: { level: 0, path: [] } }],
  } as ScrapeResult;
}

function createConfig(storePath: string): AppConfig {
  const config = loadConfig();
  config.app.storePath = storePath;
  config.app.embeddingModel = "";
  return config;
}

describe("Library identity end-to-end", () => {
  let tempDir: string;
  let appConfig: AppConfig;
  let docService: DocumentManagementService;
  let pipeline: PipelineManager;
  let scrapeTool: ScrapeTool;

  /** Opens the store in `tempDir`, with a pipeline that is never started. */
  async function openServices() {
    docService = new DocumentManagementService(new EventBusService(), appConfig);
    await docService.initialize();
    pipeline = new PipelineManager(docService, new EventBusService(), {
      recoverJobs: false,
      appConfig,
    });
    scrapeTool = new ScrapeTool(pipeline, appConfig.scraper);
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "library-identity-e2e-"));
    appConfig = createConfig(tempDir);
    await openServices();
  });

  afterEach(async () => {
    await docService.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Indexes one page into a version and marks it completely indexed. */
  async function seedIndexed(library: string, version: string, content = "hooks and state") {
    await docService.addScrapeResult(
      library,
      version,
      0,
      scrapeResult(`${DOCS_URL}/${encodeURIComponent(library)}/${version || "latest"}`, content),
    );
    const versionId = await docService.ensureVersion({ library, version });
    await docService.updateVersionStatus(versionId, VersionStatus.COMPLETED);
    await docService.storeScraperOptions(versionId, {
      url: DOCS_URL,
      library,
      version,
    } as ScraperOptions);
    return versionId;
  }

  async function listed() {
    return (await new ListLibrariesTool(docService).execute()).libraries;
  }

  function scrape(library: string, version?: string, extra: Record<string, unknown> = {}) {
    return scrapeTool.execute({
      library,
      version,
      url: DOCS_URL,
      waitForCompletion: false,
      ...extra,
    }) as Promise<{ jobId: string }>;
  }

  describe("case-insensitive reach", () => {
    it("reaches the stored library from any casing and padding", async () => {
      await seedIndexed("React", "19.0.0");
      const search = new SearchTool(docService);

      for (const name of ["react", "REACT", " React "]) {
        const { results } = await search.execute({ library: name, version: "19.0.0", query: "hooks" });
        expect(results.length).toBeGreaterThan(0);
      }
      await expect(
        new RefreshVersionTool(pipeline).execute({
          library: "REACT",
          version: "19.0.0",
          waitForCompletion: false,
        }),
      ).resolves.toHaveProperty("jobId");

      const tools = { listLibraries: new ListLibrariesTool(docService) } as McpServerTools;
      const server = createMcpServerInstance(tools, appConfig);
      const template = (server as any)._registeredResourceTemplates.versions;
      const uri = "docs://libraries/react/versions";
      const resource = await template.readCallback(
        new URL(uri),
        template.resourceTemplate.uriTemplate.match(uri),
        {},
      );
      expect(resource.contents.map((c: { text: string }) => c.text)).toEqual(["19.0.0"]);

      await new RemoveTool(docService, pipeline).execute({ library: " React ", version: "19.0.0" });
      expect(await listed()).toEqual([]);
    });

    it("keeps one library across entry points and casings", async () => {
      await scrape("Vue Router", "1.0.0");
      await pipelineRouter.createCaller({ pipeline }).enqueueScrapeJob({
        library: "vue router",
        version: "2.0.0",
        options: { url: DOCS_URL, library: "vue router" } as ScraperOptions,
      });
      await pipeline.enqueueScrapeJob("VUE ROUTER", "3.0.0", {
        url: DOCS_URL,
        library: "VUE ROUTER",
        version: "3.0.0",
      });

      const libraries = await listed();
      expect(libraries.map((l) => l.name)).toEqual(["Vue Router"]);
      expect(libraries[0].versions.map((v) => v.version).sort()).toEqual([
        "1.0.0",
        "2.0.0",
        "3.0.0",
      ]);
    });
  });

  it("treats separator-like characters as part of an opaque name", async () => {
    for (const name of ["react@18", "python/pandoc", "@tanstack/query"]) {
      await scrape(name);
    }

    const libraries = await listed();
    expect(libraries.map((l) => l.name).sort()).toEqual([
      "@tanstack/query",
      "python/pandoc",
      "react@18",
    ]);
    expect(libraries.every((l) => l.versions.map((v) => v.version).join() === "")).toBe(true);
    expect(libraries.flatMap((l) => l.versions.map((v) => v.version))).not.toContain("18");
  });

  describe("display name", () => {
    it("is shown by listings, jobs and errors, and later casings never change it", async () => {
      await seedIndexed("React", "18.0.0");
      const { jobId } = await scrape("react", "19.0.0");

      expect((await listed()).map((l) => l.name)).toEqual(["React"]);
      const { jobs } = await new ListJobsTool(pipeline).execute({});
      expect(jobs.map((j) => j.library)).toEqual(["React"]);
      const { job } = await new GetJobInfoTool(pipeline).execute({ jobId });
      expect(job?.library).toBe("React");

      await expect(
        new SearchTool(docService).execute({ library: "react", version: "17.0.0", query: "x" }),
      ).rejects.toMatchObject({ constructor: VersionNotFoundInStoreError, library: "React" });
      await expect(
        new SearchTool(docService).execute({ library: "Reakt", query: "x" }),
      ).rejects.toMatchObject({
        constructor: LibraryNotFoundInStoreError,
        similarLibraries: ["React"],
      });
    });

    it("keeps the casing a library was created with through ensureVersion", async () => {
      await docService.ensureVersion({ library: "React", version: "" });

      expect((await listed()).map((l) => l.name)).toEqual(["React"]);
    });
  });

  describe("overwrite rules", () => {
    it("rejects re-indexing an existing version and leaves its documentation intact", async () => {
      await seedIndexed("React", "");

      await expect(scrape("react")).rejects.toBeInstanceOf(VersionAlreadyExistsError);

      expect(await docService.exists("react", "")).toBe(true);
      const { results } = await new SearchTool(docService).execute({
        library: "react",
        query: "hooks",
      });
      expect(results.length).toBeGreaterThan(0);
      expect(await pipeline.getJobs()).toEqual([]);
    });

    it("adds a new version to an existing library", async () => {
      await seedIndexed("React", "18.0.0");

      await expect(scrape("react", "19.0.0")).resolves.toHaveProperty("jobId");

      expect((await listed())[0].versions.map((v) => v.version).sort()).toEqual([
        "18.0.0",
        "19.0.0",
      ]);
    });

    it("accepts replacement of an existing version and of a missing one", async () => {
      await seedIndexed("React", "19.0.0");

      await expect(scrape("React", "19.0.0", { replace: true })).resolves.toHaveProperty("jobId");
      await expect(scrape("Svelte", "5.0.0", { replace: true })).resolves.toHaveProperty("jobId");

      const libraries = await listed();
      expect(libraries.map((l) => l.name).sort()).toEqual(["React", "Svelte"]);
      expect(libraries.find((l) => l.name === "React")?.versions).toHaveLength(1);
    });

    it("accepts appending to an existing version", async () => {
      await seedIndexed("React", "19.0.0");

      await expect(
        scrape("react", "19.0.0", { options: { clean: false } }),
      ).resolves.toHaveProperty("jobId");
      expect(await docService.exists("react", "19.0.0")).toBe(true);
    });

    it("accepts refreshing a completely indexed version", async () => {
      await seedIndexed("React", "19.0.0");

      await expect(
        new RefreshVersionTool(pipeline).execute({
          library: "react",
          version: "19.0.0",
          waitForCompletion: false,
        }),
      ).resolves.toHaveProperty("jobId");
    });
  });

  it("counts a failed version as existing, while a retry replaces it", async () => {
    const versionId = await docService.ensureVersion({ library: "React", version: "19.0.0" });
    await docService.updateVersionStatus(versionId, VersionStatus.FAILED, "boom");

    await expect(scrape("react", "19.0.0")).rejects.toBeInstanceOf(VersionAlreadyExistsError);
    // The web UI's job retry sends the same request with replace
    await expect(
      pipelineRouter.createCaller({ pipeline }).enqueueScrapeJob({
        library: "React",
        version: "19.0.0",
        options: { url: DOCS_URL, library: "React", version: "19.0.0" } as ScraperOptions,
        onExisting: "replace",
      }),
    ).resolves.toHaveProperty("jobId");
  });

  it("keeps a legacy library reachable even when its name breaks the rules for new names", async () => {
    // Created before the naming rules existed; seeded in-process, bypassing validation
    const longName = "L".repeat(101);
    await docService.shutdown();
    const db = new Database(join(tempDir, "documents.db"));
    const { lastInsertRowid } = db
      .prepare("INSERT INTO libraries (name, display_name) VALUES (?, ?)")
      .run(longName.toLowerCase(), longName);
    db.prepare("INSERT INTO versions (library_id, name) VALUES (?, ?)").run(lastInsertRowid, "");
    db.close();
    await openServices();

    await docService.addScrapeResult(longName, "", 0, scrapeResult(`${DOCS_URL}/long`, "hooks"));
    const { results } = await new SearchTool(docService).execute({
      library: longName,
      query: "hooks",
    });
    expect(results.length).toBeGreaterThan(0);
    await new RemoveTool(docService, pipeline).execute({ library: longName, version: "" });
    expect(await listed()).toEqual([]);
  });

  it("frees the name when the last version is removed", async () => {
    await seedIndexed("react", "");

    await new RemoveTool(docService, pipeline).execute({ library: "React", version: "" });
    expect(await listed()).toEqual([]);

    await scrape("ReAct");
    expect((await listed()).map((l) => l.name)).toEqual(["ReAct"]);
  });

  it("rejects Add library for an existing name in any casing", async () => {
    await seedIndexed("React", "18.0.0");

    await expect(
      pipeline.enqueueScrapeJob(
        " REACT ",
        "19.0.0",
        { url: DOCS_URL, library: " REACT ", version: "19.0.0" },
        { onExisting: "reject-library" },
      ),
    ).rejects.toThrow(new LibraryAlreadyExistsError("React"));
    expect((await listed())[0].versions.map((v) => v.version)).toEqual(["18.0.0"]);
  });

  it("leaves nothing behind after a mistyped refresh", async () => {
    await expect(
      new RefreshVersionTool(pipeline).execute({ library: "Reakt", waitForCompletion: false }),
    ).rejects.toBeInstanceOf(LibraryNotFoundInStoreError);

    expect(await listed()).toEqual([]);
    await expect(
      pipeline.enqueueScrapeJob(
        "Reakt",
        null,
        { url: DOCS_URL, library: "Reakt", version: "" },
        { onExisting: "reject-library" },
      ),
    ).resolves.toEqual(expect.any(String));
  });

  it("makes a padded legacy library reachable after the upgrade", async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), "library-identity-legacy-"));
    try {
      const db = new Database(join(legacyDir, "documents.db"));
      sqliteVec.load(db);
      await applyMigrations(db);
      restorePre017Libraries(db);
      db.exec(`
        INSERT INTO libraries (name) VALUES (' react ');
        INSERT INTO versions (library_id, name) VALUES (1, '1.0.0');
      `);
      db.close();

      const upgraded = new DocumentManagementService(
        new EventBusService(),
        createConfig(legacyDir),
      );
      await upgraded.initialize();
      try {
        expect((await upgraded.listLibraries()).map((l) => l.library)).toEqual(["react"]);
        expect(await upgraded.findVersionId({ library: "react", version: "1.0.0" })).not.toBeNull();
      } finally {
        await upgraded.shutdown();
      }
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
