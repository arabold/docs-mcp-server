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
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { normalizeVersionLabel } from "../src/store/types";
import { RefreshVersionTool } from "../src/tools/RefreshVersionTool";
import { ScrapeTool } from "../src/tools/ScrapeTool";
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
});
