/**
 * End-to-end tests for version label normalization and resolution.
 *
 * These run against a real SQLite store rather than a mocked one, so they cover
 * the link a unit test cannot: that every write path lands in the same version
 * row. How a request resolves against the stored labels is tested in
 * src/store/DocumentManagementService.test.ts.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventBusService } from "../src/events";
import { PipelineManager } from "../src/pipeline/PipelineManager";
import { pipelineRouter } from "../src/pipeline/trpc/router";
import { appRouter, createAppRouterContext } from "../src/services/appRouter";
import { buildSystemInfo } from "../src/services/systemInfo";
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { normalizeVersionLabel } from "../src/store/types";
import { RefreshVersionTool } from "../src/tools/RefreshVersionTool";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { SearchTool } from "../src/tools/SearchTool";
import { type AppConfig, loadConfig } from "../src/utils/config";

describe("Version resolution end-to-end", () => {
  let tempDir: string;
  let docService: DocumentManagementService;
  let appConfig: AppConfig;
  let pipeline: PipelineManager;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "version-resolution-e2e-"));
    appConfig = loadConfig();
    appConfig.app.storePath = tempDir;
    appConfig.app.embeddingModel = ""; // FTS-only: the read path searches without credentials
    docService = new DocumentManagementService(new EventBusService(), appConfig);
    await docService.initialize();
    // Never started: jobs stay QUEUED, so nothing is actually scraped and we can
    // inspect the version label each entry point recorded.
    pipeline = new PipelineManager(docService, new EventBusService(), {
      interruptedJobs: "fail",
      appConfig,
    });
  });

  afterAll(async () => {
    await docService?.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("write path parity", () => {
    /**
     * Drives a version label through one real entry point and returns the label
     * that reaches the store layer, so a regression in any entry point's own
     * normalizer shows up as a different label rather than passing silently.
     *
     * Each scrape requests replacement: some cases send variants of one label
     * through several entry points on purpose, and without it every submission
     * after the first would be rejected as an existing version.
     */
    const labelFromEntryPoint = async (
      entryPoint: "scrapeTool" | "refreshTool" | "trpc" | "pipeline",
      library: string,
      version: string | null,
    ): Promise<string | null> => {
      let jobId: string;
      switch (entryPoint) {
        case "scrapeTool":
          jobId = (
            (await new ScrapeTool(pipeline, appConfig.scraper).execute({
              library,
              version,
              url: "https://example.com/docs",
              waitForCompletion: false,
              replace: true,
            })) as { jobId: string }
          ).jobId;
          break;
        case "refreshTool": {
          // Refreshing requires the version to exist with stored scraper
          // options. Seed it under the label the write contract produces, so a
          // normalizer regression makes the refresh miss the bucket it created.
          const label = normalizeVersionLabel(version);
          const versionId = await docService.ensureVersion({ library, version: label });
          await docService.storeScraperOptions(versionId, {
            url: "https://example.com/docs",
            library,
            version: label,
          } as never);
          jobId = (
            (await new RefreshVersionTool(pipeline).execute({
              library,
              version,
              waitForCompletion: false,
            })) as { jobId: string }
          ).jobId;
          break;
        }
        case "trpc": {
          // The web UI and any external worker reach the pipeline this way.
          jobId = (
            await pipelineRouter.createCaller({ pipeline }).enqueueScrapeJob({
              library,
              version,
              options: { url: "https://example.com/docs", library } as never,
              onExisting: "replace",
            })
          ).jobId;
          break;
        }
        case "pipeline":
          jobId = await pipeline.enqueueScrapeJob(
            library,
            version,
            { url: "https://example.com/docs", library } as never,
            { onExisting: "replace" },
          );
          break;
      }
      return (await pipeline.getJob(jobId))?.version ?? null;
    };

    const ENTRY_POINTS = ["scrapeTool", "refreshTool", "trpc", "pipeline"] as const;

    it.each([
      { input: " 1.0.0 ", expected: "1.0.0" },
      { input: "LATEST", expected: "latest" },
      { input: "1.20", expected: "1.20" },
      { input: " STABLE ", expected: "stable" },
      { input: "V2.0.0", expected: "v2.0.0" },
    ])(
      "normalizes '$input' to '$expected' identically at every entry point",
      async ({ input, expected }) => {
        const labels = await Promise.all(
          ENTRY_POINTS.map((e) =>
            labelFromEntryPoint(e, `parity-${expected}-${e}`, input),
          ),
        );

        expect(labels).toEqual(ENTRY_POINTS.map(() => expected));
      },
    );

    it("lands one version row no matter which entry point wrote the label", async () => {
      // Every entry point that creates a version feeds the same library, so
      // one that stored a variant would show up here as a second row. The
      // refresh tool is left out: it needs the row to exist already.
      const library = "paritylib";
      const writers = ["scrapeTool", "trpc", "pipeline"] as const;
      const variants = [" 1.0.0 ", "1.0.0", "1.0.0 ", " 1.0.0"];

      for (const [i, variant] of variants.entries()) {
        await labelFromEntryPoint(writers[i % writers.length], library, variant);
      }

      expect(await docService.listVersions(library)).toEqual(["1.0.0"]);
    });

    it("treats an empty or whitespace-only label as unversioned at every entry point", async () => {
      const library = "unversionedlib";
      const labels = await Promise.all(
        ENTRY_POINTS.map((e) => labelFromEntryPoint(e, `${library}-${e}`, "   ")),
      );
      // The pipeline records unversioned as "" (or null for an omitted version).
      expect(labels.every((l) => l === "" || l === null)).toBe(true);

      const ids = await Promise.all(
        ["", "   "].map((version) => docService.ensureVersion({ library, version })),
      );
      expect(new Set(ids).size).toBe(1);
      // The empty label is unversioned, not a listed version.
      expect(await docService.listVersions(library)).toEqual([]);
    });

    it("keeps a partial version distinct from its full form", async () => {
      const library = "partiallib";
      const partial = await docService.ensureVersion({
        library,
        version: (await labelFromEntryPoint("scrapeTool", library, "1.20")) ?? "",
      });
      const full = await docService.ensureVersion({
        library,
        version: (await labelFromEntryPoint("scrapeTool", library, "1.20.0")) ?? "",
      });

      // ScrapeTool used to coerce "1.20" to "1.20.0", merging the two buckets.
      expect(partial).not.toBe(full);
      expect(await docService.listVersions(library)).toEqual(["1.20.0", "1.20"]);
    });
  });

  describe("read path parity", () => {
    const library = "readparity";
    const pageUrls = {
      "3.0.0": "https://example.com/v3/refine",
      "4.1.0": "https://example.com/v4/refine",
    };
    let api: ReturnType<typeof appRouter.createCaller>;

    beforeAll(async () => {
      // The API the web UI and remote clients call, with a request's context.
      api = appRouter.createCaller(
        createAppRouterContext({
          pipeline,
          docService,
          eventBus: new EventBusService(),
          systemInfo: buildSystemInfo(
            { enableWebInterface: true, enableMcpServer: true, enableApiServer: true, port: 0 },
            appConfig,
            "http://127.0.0.1:6280/mcp",
            undefined,
          ),
        }),
      );

      for (const [version, url] of Object.entries(pageUrls)) {
        await docService.addScrapeResult(library, version, 1, {
          url,
          title: "Refinements",
          sourceContentType: "text/markdown",
          contentType: "text/markdown",
          textContent: "",
          links: [],
          errors: [],
          chunks: [
            {
              types: ["text"],
              content: "Use refine to add custom validation logic.",
              section: { level: 1, path: ["Refinements"] },
            },
          ],
        });
      }
    });

    /**
     * Searches through one real entry point and returns the URLs it found, so
     * an entry point that skips version resolution shows up as other results.
     */
    const urlsFromEntryPoint = async (
      entryPoint: "searchTool" | "trpc",
      version: string | undefined,
    ): Promise<string[]> => {
      const request = { library, version, query: "refine" };
      const { results } =
        entryPoint === "searchTool"
          ? // What the MCP search_docs tool runs.
            await new SearchTool(docService).execute(request)
          : // What the web UI's search playground calls.
            await api.searchDocs(request);
      return results.map((result) => result.url);
    };

    const READ_ENTRY_POINTS = ["searchTool", "trpc"] as const;

    it.each([
      // An MCP client omits the version; the playground's "Latest" sends "".
      { requested: "no version", version: undefined, expected: pageUrls["4.1.0"] },
      { requested: "an empty version", version: "", expected: pageUrls["4.1.0"] },
      { requested: "a version range", version: "3.x", expected: pageUrls["3.0.0"] },
    ])(
      "resolves $requested to the same version at every entry point",
      async ({ version, expected }) => {
        const urls = await Promise.all(
          READ_ENTRY_POINTS.map((e) => urlsFromEntryPoint(e, version)),
        );

        expect(urls).toEqual(READ_ENTRY_POINTS.map(() => [expected]));
      },
    );

    it("keeps the store-level search literal for remote clients", async () => {
      // Remote clients send `search` a version that is already resolved, so it
      // searches the bucket it is given; "" is the unversioned one.
      await expect(
        api.search({ library, version: "", query: "refine" }),
      ).resolves.toEqual([]);
      const [result] = await api.search({ library, version: "3.0.0", query: "refine" });
      expect(result.url).toBe(pageUrls["3.0.0"]);
    });
  });
});
