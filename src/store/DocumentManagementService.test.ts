import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBusService } from "../events";
import type { AppConfig } from "../utils/config";
import { loadConfig } from "../utils/config";
import { DocumentManagementService } from "./DocumentManagementService";
import { DocumentStore } from "./DocumentStore";
import {
  AmbiguousPageInStoreError,
  LibraryNotFoundInStoreError,
  PageNotFoundInStoreError,
  VersionNotFoundInStoreError,
} from "./errors";
import { VersionStatus } from "./types";

/**
 * Integration tests for the document management service, run against a real
 * in-memory SQLite store in full-text-only mode.
 */
describe("DocumentManagementService", () => {
  let appConfig: AppConfig;
  let docService: DocumentManagementService;

  beforeEach(async () => {
    appConfig = loadConfig();
    appConfig.app.storePath = ":memory:";
    appConfig.app.embeddingModel = ""; // FTS-only: no external credentials required
    docService = new DocumentManagementService(new EventBusService(), appConfig);
    await docService.initialize();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await docService.shutdown();
  });

  /** Stores one page with one chunk per entry in `chunks`. */
  async function addPage(
    library: string,
    version: string,
    url: string,
    chunks = ["content"],
    contentType = "text/markdown",
  ): Promise<void> {
    await docService.addScrapeResult(library, version, 1, {
      url,
      title: "Page Title",
      sourceContentType: contentType,
      contentType,
      textContent: "",
      links: [],
      errors: [],
      chunks: chunks.map((content, index) => ({
        types: ["text"],
        content,
        section: { level: 1, path: [`section${index}`] },
      })),
    });
  }

  /** Creates the given version labels for a library, without documents. */
  async function addVersions(library: string, labels: string[]): Promise<void> {
    for (const version of labels) {
      await docService.ensureVersion({ library, version });
    }
  }

  describe("ensureVersion", () => {
    it("reuses single unversioned version across multiple ensureVersion calls (regression)", async () => {
      const a = await docService.ensureVersion({ library: "TestLib", version: "" });
      const b = await docService.ensureVersion({ library: "TestLib", version: "" });
      const c = await docService.ensureVersion({ library: "TestLib", version: "" });

      expect(b).toBe(a);
      expect(c).toBe(a);
      const [library] = await docService.listLibraries();
      expect(library.versions.map((v) => v.ref.version)).toEqual([""]);
    });
  });

  describe("listVersionChunks", () => {
    it("reads chunks through a padded, differently cased library and version", async () => {
      await addPage("React", "18.2.0", "https://react.dev/hooks", ["Alpha", "Beta"]);

      const result = await docService.listVersionChunks({
        library: "  REACT  ",
        version: " 18.2.0 ",
      });

      expect(result.chunks.map((c) => c.content)).toEqual(["Alpha", "Beta"]);
    });
  });

  describe("getVersionStats", () => {
    it("reads the unversioned documentation for a blank version label", async () => {
      await addPage("Express", "", "https://expressjs.com/guide", ["Alpha", "Beta"]);

      const stats = await docService.getVersionStats({
        library: "  Express  ",
        version: "  ",
      });

      expect(stats).toMatchObject({ pageCount: 1, chunkCount: 2 });
    });
  });

  describe("shutdown", () => {
    it("shuts down a service that was never initialized", async () => {
      const service = new DocumentManagementService(new EventBusService(), appConfig);

      await expect(service.shutdown()).resolves.toBeUndefined();
    });
  });

  describe("exists", () => {
    it("treats a missing version as the unversioned documentation", async () => {
      await addPage("test-lib", "", "https://x.dev/page");

      expect(await docService.exists("test-lib", null)).toBe(true);
      expect(await docService.exists("test-lib", undefined)).toBe(true);
    });
  });

  describe("removeAllDocuments", () => {
    it("removes the documents of one version and keeps the others", async () => {
      await addPage("test-lib", "1.0.0", "https://x.dev/v1");
      await addPage("test-lib", "2.0.0", "https://x.dev/v2");

      await docService.removeAllDocuments("test-lib", "1.0.0");

      expect(await docService.exists("test-lib", "1.0.0")).toBe(false);
      expect(await docService.exists("test-lib", "2.0.0")).toBe(true);
    });

    it("removes the unversioned documents when no version is given", async () => {
      await addPage("test-lib", "", "https://x.dev/unversioned");
      await addPage("test-lib", "1.0.0", "https://x.dev/v1");

      await docService.removeAllDocuments("test-lib", null);

      expect(await docService.exists("test-lib", "")).toBe(false);
      expect(await docService.exists("test-lib", "1.0.0")).toBe(true);
    });

    it("should still remove documents when compaction fails", async () => {
      await addPage("test-lib", "1.0.0", "https://x.dev/v1");
      vi.spyOn(DocumentStore.prototype, "compact").mockRejectedValueOnce(
        new Error("checkpoint busy"),
      );

      await expect(
        docService.removeAllDocuments("test-lib", "1.0.0"),
      ).resolves.toBeUndefined();
      expect(await docService.exists("test-lib", "1.0.0")).toBe(false);
    });
  });

  describe("listVersions", () => {
    it("should sort versions newest first and opaque tags after them", async () => {
      await addVersions("test-lib", ["1.9.0", "stable", "1.10.0", "2.0.0-beta", "next"]);

      const versions = await docService.listVersions("test-lib");

      expect(versions).toEqual(["2.0.0-beta", "1.10.0", "1.9.0", "next", "stable"]);
    });

    it("should exclude the empty label, which represents unversioned content", async () => {
      await addVersions("test-lib", ["1.0.0", "", "2.0.0"]);

      const versions = await docService.listVersions("test-lib");

      expect(versions).toEqual(["2.0.0", "1.0.0"]);
    });
  });

  describe("findBestVersion", () => {
    const library = "test-lib";

    /** Stores a page of unversioned documentation for the library. */
    const addUnversionedPage = () => addPage(library, "", "https://x.dev/unversioned");

    // --- Literal Label Resolution -------------------------------------------

    describe("literal label resolution", () => {
      it("should resolve an opaque tag by its own name", async () => {
        // Regression for issue #475: a library indexed as "latest" was
        // unreachable over MCP because tags never reached the resolver.
        await addVersions(library, ["latest"]);

        const result = await docService.findBestVersion(library, "latest");
        expect(result).toEqual({ bestMatch: "latest", hasUnversioned: false });
      });

      it("should match literally regardless of case and surrounding whitespace", async () => {
        await addVersions(library, ["stable"]);

        const result = await docService.findBestVersion(library, " STABLE ");
        expect(result).toEqual({ bestMatch: "stable", hasUnversioned: false });
      });

      it("should resolve a partial version to itself when its full form also exists", async () => {
        await addVersions(library, ["1.20", "1.20.0"]);

        const result = await docService.findBestVersion(library, "1.20");
        expect(result).toEqual({ bestMatch: "1.20", hasUnversioned: false });
      });

      it("should resolve a full version to itself when its partial form also exists", async () => {
        await addVersions(library, ["1.20", "1.20.0"]);

        const result = await docService.findBestVersion(library, "1.20.0");
        expect(result).toEqual({ bestMatch: "1.20.0", hasUnversioned: false });
      });

      it("should resolve a prerelease by its own name without the release taking its place", async () => {
        await addVersions(library, ["2.0.0", "2.0.0-beta"]);

        const result = await docService.findBestVersion(library, "2.0.0-beta");
        expect(result).toEqual({ bestMatch: "2.0.0-beta", hasUnversioned: false });
      });

      it("should resolve a stored label that looks like a range by its own name", async () => {
        await addVersions(library, ["1.x", "1.0.0"]);

        const result = await docService.findBestVersion(library, "1.x");
        expect(result).toEqual({ bestMatch: "1.x", hasUnversioned: false });
      });
    });

    // --- Semantic Version Resolution ----------------------------------------

    describe("semantic version resolution", () => {
      it("should select a prerelease when it is the only version indexed", async () => {
        await addVersions(library, ["2.0.0-beta"]);

        await expect(docService.findBestVersion(library)).resolves.toEqual({
          bestMatch: "2.0.0-beta",
          hasUnversioned: false,
        });
        await expect(docService.findBestVersion(library, "latest")).resolves.toEqual({
          bestMatch: "2.0.0-beta",
          hasUnversioned: false,
        });
      });

      it("should let the newest version win even when it is a prerelease", async () => {
        await addVersions(library, ["1.0.0", "2.0.0-beta"]);

        await expect(docService.findBestVersion(library)).resolves.toEqual({
          bestMatch: "2.0.0-beta",
          hasUnversioned: false,
        });
        await expect(docService.findBestVersion(library, "latest")).resolves.toEqual({
          bestMatch: "2.0.0-beta",
          hasUnversioned: false,
        });
      });

      it("should let a released version supersede its own prerelease", async () => {
        await addVersions(library, ["1.0.0", "2.0.0-beta", "2.0.0"]);

        const result = await docService.findBestVersion(library, "latest");
        expect(result).toEqual({ bestMatch: "2.0.0", hasUnversioned: false });
      });

      it("should prefer a prerelease of the requested version over an older major", async () => {
        await addVersions(library, ["1.0.0", "2.0.0-beta"]);

        const result = await docService.findBestVersion(library, "2.0.0");
        expect(result).toEqual({ bestMatch: "2.0.0-beta", hasUnversioned: false });
      });

      it("should select a prerelease within an X-range", async () => {
        await addVersions(library, ["1.0.0", "2.0.0-beta"]);

        const result = await docService.findBestVersion(library, "2.x");
        expect(result).toEqual({ bestMatch: "2.0.0-beta", hasUnversioned: false });
      });

      it("should select a prerelease for a major-only request", async () => {
        await addVersions(library, ["1.0.0", "2.0.0-beta"]);

        const result = await docService.findBestVersion(library, "2");
        expect(result).toEqual({ bestMatch: "2.0.0-beta", hasUnversioned: false });
      });

      it("should fall back below the request and may select a prerelease", async () => {
        await addVersions(library, ["1.0.0", "2.0.0-beta"]);

        const result = await docService.findBestVersion(library, "3.0.0");
        expect(result).toEqual({ bestMatch: "2.0.0-beta", hasUnversioned: false });
      });

      it("should not select a newer prerelease for an older request", async () => {
        await addVersions(library, ["1.0.0", "1.0.1-beta"]);

        const result = await docService.findBestVersion(library, "1.0.0");
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: false });
      });

      it("should order prereleases of the same version among themselves", async () => {
        await addVersions(library, ["2.0.0-rc.1", "2.0.0-rc.2"]);

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "2.0.0-rc.2", hasUnversioned: false });
      });

      it("should not match when nothing sits at or below the request", async () => {
        await addVersions(library, ["2.0.0-beta"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library, "1.20");
        expect(result).toEqual({ bestMatch: null, hasUnversioned: true });
      });

      it("should match partial stored versions", async () => {
        await addVersions(library, ["1.20", "5"]);

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "5", hasUnversioned: false });
      });

      it("should exclude opaque tags from semantic matching", async () => {
        await addVersions(library, ["1.0.0", "stable-2024", "node18"]);

        // "stable-2024" must not be read as 2024.0.0, nor "node18" as 18.0.0.
        const result = await docService.findBestVersion(library, "latest");
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: false });
      });

      it("should prefer the strict label when a partial and its full version tie", async () => {
        await addVersions(library, ["1.20", "1.20.0"]);

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "1.20.0", hasUnversioned: false });
      });

      it("should return best match and hasUnversioned=false when only semver exists", async () => {
        await addVersions(library, ["1.0.0", "1.1.0", "2.0.0"]);

        const result = await docService.findBestVersion(library, "1.5.0");
        expect(result).toEqual({ bestMatch: "1.1.0", hasUnversioned: false });
      });

      it("should return the latest match for 'latest' and for no target", async () => {
        await addVersions(library, ["1.0.0", "2.0.0", "3.0.0"]);

        await expect(docService.findBestVersion(library, "latest")).resolves.toEqual({
          bestMatch: "3.0.0",
          hasUnversioned: false,
        });
        await expect(docService.findBestVersion(library)).resolves.toEqual({
          bestMatch: "3.0.0",
          hasUnversioned: false,
        });
      });

      it("should honour an X-range request", async () => {
        await addVersions(library, ["1.0.0", "1.1.0"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library, "1.0.x");
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: true });
      });

      it("should fall back to the latest available when the target is higher", async () => {
        await addVersions(library, ["1.0.0", "1.1.0"]);

        await expect(docService.findBestVersion(library, "3.0.0")).resolves.toEqual({
          bestMatch: "1.1.0",
          hasUnversioned: false,
        });

        await addUnversionedPage();
        await expect(docService.findBestVersion(library, "3.0.0")).resolves.toEqual({
          bestMatch: "1.1.0",
          hasUnversioned: true,
        });
      });
    });

    // --- Tag-Only Library Resolution ----------------------------------------

    describe("tag-only library resolution", () => {
      it("should resolve a single tag without an explicit request", async () => {
        // Regression for issue #475: search_docs with no version argument.
        await addVersions(library, ["latest"]);

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "latest", hasUnversioned: false });
      });

      it("should refuse to rank multiple tags", async () => {
        await addVersions(library, ["stable", "next"]);

        const error = (await docService
          .findBestVersion(library)
          .catch((e) => e)) as VersionNotFoundInStoreError;
        expect(error).toBeInstanceOf(VersionNotFoundInStoreError);
        expect(error.availableVersions).toEqual(["next", "stable"]);
      });

      it("should fall through to unversioned when tags are ambiguous", async () => {
        // Ambiguous tags mean no tag resolves, but erroring while the library
        // holds usable unversioned documentation would be worse than handing
        // it back. find_version still reports that no version matched.
        await addVersions(library, ["stable", "next"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: null, hasUnversioned: true });
      });

      it("should not let a single tag outrank a semantic version", async () => {
        await addVersions(library, ["1.0.0", "stable"]);

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: false });
      });
    });

    // --- Unversioned Documentation Resolution -------------------------------

    describe("unversioned documentation", () => {
      it("should report unversioned availability alongside a match", async () => {
        await addVersions(library, ["1.0.0"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library, "1.0.0");
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: true });
      });

      it("should use unversioned documentation when nothing resolves", async () => {
        await addUnversionedPage();

        await expect(docService.findBestVersion(library)).resolves.toEqual({
          bestMatch: null,
          hasUnversioned: true,
        });
        await expect(docService.findBestVersion(library, "9.9.9")).resolves.toEqual({
          bestMatch: null,
          hasUnversioned: true,
        });
      });

      it("should not silently skip a prerelease in favour of unversioned", async () => {
        await addVersions(library, ["2.0.0-beta"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "2.0.0-beta", hasUnversioned: true });
      });

      it("should not make unversioned the resolver's default just because it lists first", async () => {
        // The canonical listing order puts unversioned first, which the web UI
        // uses as its default selection. Resolution answers a different
        // question and picks the newest semantic version.
        await addVersions(library, ["1.0.0"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: true });
      });

      it("should not silently skip a tag in favour of unversioned", async () => {
        await addVersions(library, ["latest"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library, "latest");
        expect(result).toEqual({ bestMatch: "latest", hasUnversioned: true });
      });
    });

    // --- Resolution Failure Reporting ---------------------------------------

    describe("resolution failure reporting", () => {
      it("should list tags among the available labels", async () => {
        await addVersions(library, ["1.0.0", "stable"]);

        // Nothing at or below 0.0.1, and "stable" cannot be ranked.
        const error = (await docService
          .findBestVersion(library, "0.0.1")
          .catch((e) => e)) as VersionNotFoundInStoreError;
        expect(error).toBeInstanceOf(VersionNotFoundInStoreError);
        expect(error.availableVersions).toEqual(["1.0.0", "stable"]);
      });

      it("should raise LibraryNotFoundInStoreError when the library is unknown", async () => {
        await expect(docService.findBestVersion(library, "1.0.0")).rejects.toThrow(
          LibraryNotFoundInStoreError,
        );

        const error = (await docService
          .findBestVersion(library)
          .catch((e) => e)) as LibraryNotFoundInStoreError;
        expect(error).toBeInstanceOf(LibraryNotFoundInStoreError);
        expect(error.library).toBe(library);
        expect(error.similarLibraries).toEqual([]);
      });

      it("should report unversioned availability for an unparseable request", async () => {
        await addVersions(library, ["1.0.0"]);
        await addUnversionedPage();

        const result = await docService.findBestVersion(library, "not a version!");
        expect(result).toEqual({ bestMatch: null, hasUnversioned: true });
      });

      it("should throw for an unparseable request when only versions exist", async () => {
        await addVersions(library, ["1.0.0"]);

        await expect(
          docService.findBestVersion(library, "not a version!"),
        ).rejects.toThrow(VersionNotFoundInStoreError);
      });
    });
  });

  describe("listLibraries", () => {
    it("counts each version's chunks and distinct pages", async () => {
      await addPage("count-lib", "1.0.0", "https://x.dev/a", ["one", "two"]);
      await addPage("count-lib", "1.0.0", "https://x.dev/b", ["three"]);

      const [library] = await docService.listLibraries();

      expect(library.versions[0].counts).toEqual({ documents: 3, uniqueUrls: 2 });
    });

    it("includes progress only for versions that are not completed", async () => {
      const completed = await docService.ensureVersion({
        library: "lib",
        version: "1.0.0",
      });
      await docService.updateVersionProgress(completed, 5, 5);
      await docService.updateVersionStatus(completed, VersionStatus.COMPLETED);
      const running = await docService.ensureVersion({
        library: "lib",
        version: "1.1.0",
      });
      await docService.updateVersionProgress(running, 2, 10);
      await docService.updateVersionStatus(running, VersionStatus.RUNNING);

      const [library] = await docService.listLibraries();
      const byVersion = Object.fromEntries(
        library.versions.map((v) => [v.ref.version, v]),
      );

      expect(byVersion["1.0.0"]).toMatchObject({ status: "completed" });
      expect(byVersion["1.0.0"].progress).toBeUndefined();
      expect(byVersion["1.1.0"]).toMatchObject({
        status: "running",
        progress: { pages: 2, maxPages: 10 },
      });
    });

    it("reports whether a version was scraped with URL hashes preserved", async () => {
      const preserving = await docService.ensureVersion({
        library: "lib",
        version: "1.0.0",
      });
      await docService.storeScraperOptions(preserving, {
        url: "https://x.dev",
        library: "lib",
        version: "1.0.0",
        preserveHashes: true,
      });
      await docService.ensureVersion({ library: "lib", version: "2.0.0" });

      const [library] = await docService.listLibraries();
      const byVersion = Object.fromEntries(
        library.versions.map((v) => [v.ref.version, v]),
      );

      expect(byVersion["1.0.0"].preserveHashes).toBe(true);
      expect(byVersion["2.0.0"].preserveHashes).toBeUndefined();
    });

    it("should correctly handle libraries with only unversioned entries", async () => {
      await addPage("lib-unversioned", "", "https://x.dev/page");

      const result = await docService.listLibraries();

      expect(result).toMatchObject([
        {
          library: "lib-unversioned",
          versions: [{ ref: { library: "lib-unversioned", version: "" } }],
        },
      ]);
    });
  });

  describe("searchStore", () => {
    it("returns at most five results by default", async () => {
      for (let i = 0; i < 6; i++) {
        await addPage("search-lib", "1.0.0", `https://x.dev/page${i}`, [
          `Zebra page ${i}`,
        ]);
      }

      const results = await docService.searchStore("search-lib", "1.0.0", "zebra");

      expect(results).toHaveLength(5);
    });
  });

  describe("validateLibraryExists", () => {
    it("should handle case insensitivity", async () => {
      await addPage("test-lib", "1.0.0", "https://x.dev/page");

      await expect(docService.validateLibraryExists("TEST-LIB")).resolves.toBeUndefined();
    });

    it("should throw LibraryNotFoundInStoreError if library does not exist (no suggestions)", async () => {
      const error = (await docService
        .validateLibraryExists("non-existent-lib")
        .catch((e) => e)) as LibraryNotFoundInStoreError;

      expect(error).toBeInstanceOf(LibraryNotFoundInStoreError);
      expect(error.library).toBe("non-existent-lib");
      expect(error.similarLibraries).toEqual([]);
    });

    it("should throw LibraryNotFoundInStoreError with suggestions if library does not exist", async () => {
      await addVersions("test-lib", ["1.0.0"]);
      await addVersions("another-lib", ["2.0.0"]);
      await addVersions("react", [""]);

      const error = (await docService
        .validateLibraryExists("reac")
        .catch((e) => e)) as LibraryNotFoundInStoreError;

      expect(error).toBeInstanceOf(LibraryNotFoundInStoreError);
      expect(error.library).toBe("reac");
      expect(error.similarLibraries).toEqual(["react"]);
    });
  });

  describe("page reading", () => {
    const library = "pages-lib";

    const addPageToRead = (
      url: string,
      chunks = ["content"],
      contentType = "text/markdown",
    ) => addPage(library, "1.0.0", url, chunks, contentType);

    it("reads a page stored with a percent-encoded URL when given that exact URL", async () => {
      await addPageToRead("https://x.dev/docs/My%20Page");

      const result = await docService.getPageContent(
        library,
        "1.0.0",
        "https://x.dev/docs/My%20Page",
      );

      expect(result.url).toBe("https://x.dev/docs/My%20Page");
    });

    it("reads a percent-encoded page from a path with a literal space", async () => {
      await addPageToRead("https://x.dev/docs/My%20Page");

      const result = await docService.getPageContent(library, "1.0.0", "/docs/My Page");

      expect(result.url).toBe("https://x.dev/docs/My%20Page");
    });

    it("reads a page from a URL with a trailing slash", async () => {
      await addPageToRead("https://x.dev/docs/guide");

      const result = await docService.getPageContent(
        library,
        "1.0.0",
        "https://x.dev/docs/guide/",
      );

      expect(result.url).toBe("https://x.dev/docs/guide");
    });

    it("rejects a path that matches several pages and lists every match", async () => {
      await addPageToRead("https://x.dev/v1/api");
      await addPageToRead("https://x.dev/v2/api");

      const read = docService.getPageContent(library, "1.0.0", "/api");

      await expect(read).rejects.toThrow(AmbiguousPageInStoreError);
      await expect(read).rejects.toThrow(
        /https:\/\/x\.dev\/v1\/api.*https:\/\/x\.dev\/v2\/api/,
      );
    });

    it("resolves a hash-only route to its hash-routed page", async () => {
      await addPageToRead("https://x.dev/app#/guide");

      const result = await docService.getPageContent(library, "1.0.0", "#/guide");

      expect(result.url).toBe("https://x.dev/app#/guide");
    });

    it("prefers the hash-routed page over the page without the fragment", async () => {
      await addPageToRead("https://x.dev/app");
      await addPageToRead("https://x.dev/app#/guide");

      const result = await docService.getPageContent(library, "1.0.0", "/app#/guide");

      expect(result.url).toBe("https://x.dev/app#/guide");
    });

    it("falls back to the page without its anchor", async () => {
      await addPageToRead("https://x.dev/docs/page");

      const result = await docService.getPageContent(
        library,
        "1.0.0",
        "https://x.dev/docs/page#install",
      );

      expect(result.url).toBe("https://x.dev/docs/page");
    });

    it("suggests pages containing the last path segment when nothing matches", async () => {
      await addPageToRead("https://x.dev/docs/hooks/useState");

      const read = docService.getPageContent(library, "1.0.0", "/reference/useState");

      await expect(read).rejects.toThrow(PageNotFoundInStoreError);
      await expect(read).rejects.toThrow("https://x.dev/docs/hooks/useState");
    });

    it("joins source code chunks without separators", async () => {
      await addPageToRead(
        "https://x.dev/src/a.ts",
        ["function a() {\n", "  return 1;\n", "}\n"],
        "text/x-typescript",
      );

      const result = await docService.getPageContent(library, "1.0.0", "/src/a.ts");

      expect(result.content).toBe("function a() {\n  return 1;\n}\n");
    });

    it("returns whole chunks up to maxChars and the chunk to continue from", async () => {
      await addPageToRead("https://x.dev/long", [
        "a".repeat(10),
        "b".repeat(10),
        "c".repeat(10),
      ]);

      const result = await docService.getPageContent(library, "1.0.0", "/long", {
        maxChars: 25,
      });

      expect(result.content).toBe(`${"a".repeat(10)}\n\n${"b".repeat(10)}`);
      expect(result.nextChunk).toBe(2);
      expect(result.totalChunks).toBe(3);
    });

    it("continues from startChunk to the end of the page", async () => {
      await addPageToRead("https://x.dev/long", [
        "a".repeat(10),
        "b".repeat(10),
        "c".repeat(10),
      ]);

      const result = await docService.getPageContent(library, "1.0.0", "/long", {
        startChunk: 2,
        maxChars: 25,
      });

      expect(result.content).toBe("c".repeat(10));
      expect(result.nextChunk).toBeNull();
    });

    it("returns a single chunk longer than maxChars rather than nothing", async () => {
      await addPageToRead("https://x.dev/long", ["a".repeat(50), "b"]);

      const result = await docService.getPageContent(library, "1.0.0", "/long", {
        maxChars: 10,
      });

      expect(result.content).toBe("a".repeat(50));
      expect(result.nextChunk).toBe(1);
    });

    it("lists pages of the resolved version and reports that more follow", async () => {
      await addPageToRead("https://x.dev/a");
      await addPageToRead("https://x.dev/b");
      await addPageToRead("https://x.dev/c");

      const result = await docService.listPages(library, undefined, { limit: 2 });

      expect(result.version).toBe("1.0.0");
      expect(result.total).toBe(3);
      expect(result.pages).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });
});
