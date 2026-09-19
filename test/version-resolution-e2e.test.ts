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
import { DocumentManagementService } from "../src/store/DocumentManagementService";
import { VersionNotFoundInStoreError } from "../src/store/errors";
import { RefreshVersionTool } from "../src/tools/RefreshVersionTool";
import { ScrapeTool } from "../src/tools/ScrapeTool";
import { type AppConfig, loadConfig } from "../src/utils/config";

describe("Version resolution end-to-end", () => {
  let tempDir: string;
  let docService: DocumentManagementService;
  let appConfig: AppConfig;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "version-resolution-e2e-"));
    appConfig = loadConfig();
    appConfig.app.storePath = tempDir;
    docService = new DocumentManagementService(new EventBusService(), appConfig);
    await docService.initialize();
  });

  afterAll(async () => {
    await docService?.shutdown();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("write path parity", () => {
    it("lands the same label in one version row regardless of entry point", async () => {
      // The web UI and raw tRPC reach the store through ensureVersion, while
      // the MCP and CLI tools go through the pipeline. All must normalize
      // identically, or the same label becomes two buckets.
      const library = "paritylib";
      const ids = await Promise.all(
        [" 1.0.0 ", "1.0.0", "1.0.0 ", " 1.0.0"].map((version) =>
          docService.ensureVersion({ library, version }),
        ),
      );

      expect(new Set(ids).size).toBe(1);
      expect(await docService.listVersions(library)).toEqual(["1.0.0"]);
    });

    it("collapses case differences into one version row", async () => {
      const library = "caselib";
      const a = await docService.ensureVersion({ library, version: "LATEST" });
      const b = await docService.ensureVersion({ library, version: "latest" });

      expect(a).toBe(b);
      expect(await docService.listVersions(library)).toEqual(["latest"]);
    });

    it("treats an empty or whitespace-only label as unversioned", async () => {
      const library = "unversionedlib";
      const ids = await Promise.all(
        ["", "   "].map((version) => docService.ensureVersion({ library, version })),
      );

      expect(new Set(ids).size).toBe(1);
      // The empty label is unversioned, not a listed version.
      expect(await docService.listVersions(library)).toEqual([]);
    });

    it("keeps a partial version distinct from its full form", async () => {
      const library = "partiallib";
      const partial = await docService.ensureVersion({ library, version: "1.20" });
      const full = await docService.ensureVersion({ library, version: "1.20.0" });

      expect(partial).not.toBe(full);
      expect(await docService.listVersions(library)).toEqual(["1.20.0", "1.20"]);
    });

    it("accepts a non-version label through the scrape and refresh tools", async () => {
      // Both tools used to reject anything that was not strict semver.
      const enqueued: Array<string | null> = [];
      const fakePipeline = {
        enqueueScrapeJob: async (_lib: string, version: string | null) => {
          enqueued.push(version);
          return "job-1";
        },
        enqueueRefreshJob: async (_lib: string, version: string | null) => {
          enqueued.push(version);
          return "job-2";
        },
        waitForJobCompletion: async () => undefined,
        getJob: async () => ({ status: "completed", progress: { pagesScraped: 0 } }),
      } as unknown as PipelineManager;

      const scrapeTool = new ScrapeTool(fakePipeline, appConfig.scraper);
      const refreshTool = new RefreshVersionTool(fakePipeline);

      await scrapeTool.execute({
        library: "taglib",
        version: " STABLE ",
        url: "https://example.com",
      });
      await refreshTool.execute({ library: "taglib", version: "stable" });

      expect(enqueued).toEqual(["stable", "stable"]);
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
