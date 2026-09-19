/**
 * End-to-end tests for version label normalization and resolution.
 *
 * These run against a real SQLite store rather than a mocked one, so they cover
 * the links a unit test cannot: that every write path lands in the same version
 * row, and that the label a caller gets back is the one actually in the store.
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
import { VersionNotFoundInStoreError } from "../src/store/errors";
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
      recoverJobs: false,
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
            })
          ).jobId;
          break;
        }
        case "pipeline":
          jobId = await pipeline.enqueueScrapeJob(library, version, {
            url: "https://example.com/docs",
            library,
          } as never);
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
      // Every entry point feeds the same library, so a normalizer that let a
      // variant through would show up here as a second bucket.
      const library = "paritylib";
      const variants = [" 1.0.0 ", "1.0.0", "1.0.0 ", " 1.0.0"];

      const ids: number[] = [];
      for (const [i, variant] of variants.entries()) {
        const label = await labelFromEntryPoint(
          ENTRY_POINTS[i % ENTRY_POINTS.length],
          library,
          variant,
        );
        ids.push(await docService.ensureVersion({ library, version: label ?? "" }));
      }

      expect(new Set(ids).size).toBe(1);
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

    it("accepts a non-version label through the scrape and refresh tools", async () => {
      // Both tools used to reject anything that was not strict semver.
      await expect(
        labelFromEntryPoint("scrapeTool", "taglib-scrape", " STABLE "),
      ).resolves.toBe("stable");
      await expect(
        labelFromEntryPoint("refreshTool", "taglib-refresh", "stable"),
      ).resolves.toBe("stable");
    });
  });

  describe("resolution against a real store", () => {
    it("resolves an opaque tag by its own name and with no target", async () => {
      // Regression for issue #475.
      const library = "medusa";
      await docService.ensureVersion({ library, version: "latest" });

      await expect(docService.findBestVersion(library, "latest")).resolves.toEqual({
        bestMatch: "latest",
        hasUnversioned: false,
      });
      await expect(docService.findBestVersion(library)).resolves.toEqual({
        bestMatch: "latest",
        hasUnversioned: false,
      });
    });

    it("resolves a partial version by its own name", async () => {
      // Regression for issue #480.
      const library = "cilium";
      await docService.ensureVersion({ library, version: "1.20" });

      await expect(docService.findBestVersion(library, "1.20")).resolves.toEqual({
        bestMatch: "1.20",
        hasUnversioned: false,
      });
      await expect(docService.findBestVersion(library, "1.x")).resolves.toEqual({
        bestMatch: "1.20",
        hasUnversioned: false,
      });
    });

    it("prefers a prerelease over an older major for the requested version", async () => {
      const library = "prelib";
      await docService.ensureVersion({ library, version: "1.0.0" });
      await docService.ensureVersion({ library, version: "2.0.0-beta" });

      await expect(docService.findBestVersion(library, "2.0.0")).resolves.toEqual({
        bestMatch: "2.0.0-beta",
        hasUnversioned: false,
      });
      await expect(docService.findBestVersion(library)).resolves.toEqual({
        bestMatch: "2.0.0-beta",
        hasUnversioned: false,
      });
    });

    it("lets a released version supersede its own prerelease", async () => {
      const library = "prelib2";
      await docService.ensureVersion({ library, version: "1.0.0" });
      await docService.ensureVersion({ library, version: "2.0.0-beta" });
      await docService.ensureVersion({ library, version: "2.0.0" });

      await expect(docService.findBestVersion(library)).resolves.toEqual({
        bestMatch: "2.0.0",
        hasUnversioned: false,
      });
    });

    it("refuses to rank multiple tags and lists them in the error", async () => {
      const library = "multitag";
      await docService.ensureVersion({ library, version: "stable" });
      await docService.ensureVersion({ library, version: "next" });

      const error = (await docService
        .findBestVersion(library)
        .catch((e) => e)) as VersionNotFoundInStoreError;

      expect(error).toBeInstanceOf(VersionNotFoundInStoreError);
      expect(error.availableVersions).toEqual(
        expect.arrayContaining(["stable", "next"]),
      );
    });

    it("errors on ambiguous tags when an empty version row holds no documents", async () => {
      // An unversioned *row* is not unversioned *documentation*: resolution
      // checks for documents, so an empty bucket is no fallback and the
      // ambiguous tags still surface as an error listing the labels.
      const library = "multitag-unversioned";
      for (const version of ["stable", "next", ""]) {
        await docService.ensureVersion({ library, version });
      }

      await expect(docService.findBestVersion(library)).rejects.toThrow(
        VersionNotFoundInStoreError,
      );
    });

    it("orders listings newest first, with tags last", async () => {
      const library = "orderlib";
      for (const version of ["1.9.0", "1.10.0", "stable", "2.0.0-beta"]) {
        await docService.ensureVersion({ library, version });
      }

      expect(await docService.listVersions(library)).toEqual([
        "2.0.0-beta",
        "1.10.0",
        "1.9.0",
        "stable",
      ]);

      // The listing surface and the resolver agree on the newest version.
      const [summary] = (await docService.listLibraries()).filter(
        (l) => l.library === library,
      );
      expect(summary.versions[0].ref.version).toBe("2.0.0-beta");
      const { bestMatch } = await docService.findBestVersion(library);
      expect(bestMatch).toBe("2.0.0-beta");
    });
  });
});
