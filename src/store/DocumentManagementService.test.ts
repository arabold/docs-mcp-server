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

  it("reads the chunk explorer through normalized library and version labels", async () => {
    await addPage("React", "18.2.0", "https://react.dev/hooks", ["Alpha", "Beta"]);
    await addPage("Express", "", "https://expressjs.com/guide", ["Alpha", "Beta"]);

    const chunks = await docService.listVersionChunks({
      library: "  REACT  ",
      version: " 18.2.0 ",
    });
    expect(chunks.chunks.map((c) => c.content)).toEqual(["Alpha", "Beta"]);

    // A blank version label reads the unversioned documentation
    const stats = await docService.getVersionStats({
      library: "  Express  ",
      version: "  ",
    });
    expect(stats).toMatchObject({ pageCount: 1, chunkCount: 2 });
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
    it("removes the documents of one version, or the unversioned ones, and keeps the others", async () => {
      await addPage("test-lib", "", "https://x.dev/unversioned");
      await addPage("test-lib", "1.0.0", "https://x.dev/v1");
      await addPage("test-lib", "2.0.0", "https://x.dev/v2");

      await docService.removeAllDocuments("test-lib", "1.0.0");
      expect(await docService.exists("test-lib", "1.0.0")).toBe(false);
      expect(await docService.exists("test-lib", "2.0.0")).toBe(true);
      expect(await docService.exists("test-lib", "")).toBe(true);

      // No version means the unversioned documentation
      await docService.removeAllDocuments("test-lib", null);
      expect(await docService.exists("test-lib", "")).toBe(false);
      expect(await docService.exists("test-lib", "2.0.0")).toBe(true);
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
    it("orders listings newest first, with tags last", async () => {
      await addVersions("orderlib", [
        "1.9.0",
        "1.10.0",
        "stable",
        "2.0.0-beta",
        "",
        "next",
      ]);

      // The empty label is unversioned content, not a listed version
      expect(await docService.listVersions("orderlib")).toEqual([
        "2.0.0-beta",
        "1.10.0",
        "1.9.0",
        "next",
        "stable",
      ]);

      // The library listing puts unversioned first, and it, the version listing
      // and the resolver agree on the newest version.
      const [summary] = await docService.listLibraries();
      expect(summary.versions.map((v) => v.ref.version)).toEqual([
        "",
        "2.0.0-beta",
        "1.10.0",
        "1.9.0",
        "next",
        "stable",
      ]);
      expect(await docService.findBestVersion("orderlib")).toEqual({
        bestMatch: "2.0.0-beta",
        hasUnversioned: false,
      });
    });
  });

  describe("findBestVersion", () => {
    /**
     * A resolution case: the labels a library stores, whether it also holds
     * unversioned documentation, and the requests that must all resolve to
     * `expected`. Each case gets its own library, so one store serves them all.
     */
    interface ResolutionCase {
      label: string;
      versions: string[];
      unversioned?: boolean;
      requests: (string | undefined)[];
      expected: string | null;
    }

    /** Seeds every case under its own library and checks each request. */
    async function expectResolutions(cases: ResolutionCase[]): Promise<void> {
      for (const [index, testCase] of cases.entries()) {
        const library = `resolve-${index}`;
        await addVersions(library, testCase.versions);
        if (testCase.unversioned) {
          await addPage(library, "", `https://x.dev/${library}/unversioned`);
        }
        for (const request of testCase.requests) {
          expect
            .soft(
              await docService.findBestVersion(library, request),
              `${testCase.label} (request: ${request ?? "none"})`,
            )
            .toEqual({
              bestMatch: testCase.expected,
              hasUnversioned: testCase.unversioned ?? false,
            });
        }
      }
    }

    it("resolves a request that names a stored label to that label", async () => {
      await expectResolutions([
        // Regression for issue #475: a library indexed as "latest" was
        // unreachable over MCP because tags never reached the resolver.
        {
          label: "an opaque tag by its own name",
          versions: ["latest"],
          requests: ["latest"],
          expected: "latest",
        },
        {
          label: "literally, regardless of case and surrounding whitespace",
          versions: ["stable"],
          requests: [" STABLE "],
          expected: "stable",
        },
        {
          label: "a partial version to itself when its full form also exists",
          versions: ["1.20", "1.20.0"],
          requests: ["1.20"],
          expected: "1.20",
        },
        {
          label: "a full version to itself when its partial form also exists",
          versions: ["1.20", "1.20.0"],
          requests: ["1.20.0"],
          expected: "1.20.0",
        },
        {
          label: "a prerelease by its own name without the release taking its place",
          versions: ["2.0.0", "2.0.0-beta"],
          requests: ["2.0.0-beta"],
          expected: "2.0.0-beta",
        },
        {
          label: "a stored label that looks like a range by its own name",
          versions: ["1.x", "1.0.0"],
          requests: ["1.x"],
          expected: "1.x",
        },
        // Regression for issue #480: a partial version stored alone resolves by
        // its own name and through a range
        {
          label: "a partial version stored alone",
          versions: ["1.20"],
          requests: ["1.20", "1.x"],
          expected: "1.20",
        },
      ]);
    });

    it("resolves a semantic request to the newest version at or below it", async () => {
      await expectResolutions([
        {
          label: "a prerelease when it is the only version indexed",
          versions: ["2.0.0-beta"],
          requests: [undefined, "latest"],
          expected: "2.0.0-beta",
        },
        {
          label: "the newest version even when it is a prerelease",
          versions: ["1.0.0", "2.0.0-beta"],
          requests: [undefined, "latest"],
          expected: "2.0.0-beta",
        },
        {
          label: "a released version superseding its own prerelease",
          versions: ["1.0.0", "2.0.0-beta", "2.0.0"],
          requests: ["latest", undefined],
          expected: "2.0.0",
        },
        {
          label: "a prerelease of the requested version over an older major",
          versions: ["1.0.0", "2.0.0-beta"],
          requests: ["2.0.0"],
          expected: "2.0.0-beta",
        },
        {
          label: "a prerelease within an X-range",
          versions: ["1.0.0", "2.0.0-beta"],
          requests: ["2.x"],
          expected: "2.0.0-beta",
        },
        {
          label: "a prerelease for a major-only request",
          versions: ["1.0.0", "2.0.0-beta"],
          requests: ["2"],
          expected: "2.0.0-beta",
        },
        {
          label: "a fallback below the request, which may be a prerelease",
          versions: ["1.0.0", "2.0.0-beta"],
          requests: ["3.0.0"],
          expected: "2.0.0-beta",
        },
        {
          label: "no newer prerelease for an older request",
          versions: ["1.0.0", "1.0.1-beta"],
          requests: ["1.0.0"],
          expected: "1.0.0",
        },
        {
          label: "prereleases of the same version ordered among themselves",
          versions: ["2.0.0-rc.1", "2.0.0-rc.2"],
          requests: [undefined],
          expected: "2.0.0-rc.2",
        },
        {
          label: "partial stored versions",
          versions: ["1.20", "5"],
          requests: [undefined],
          expected: "5",
        },
        // "stable-2024" must not be read as 2024.0.0, nor "node18" as 18.0.0.
        {
          label: "opaque tags excluded from semantic matching",
          versions: ["1.0.0", "stable-2024", "node18"],
          requests: ["latest"],
          expected: "1.0.0",
        },
        {
          label: "the strict label when a partial and its full version tie",
          versions: ["1.20", "1.20.0"],
          requests: [undefined],
          expected: "1.20.0",
        },
        {
          label: "the best match when only semver exists",
          versions: ["1.0.0", "1.1.0", "2.0.0"],
          requests: ["1.5.0"],
          expected: "1.1.0",
        },
        {
          label: "the latest version for 'latest' and for no target",
          versions: ["1.0.0", "2.0.0", "3.0.0"],
          requests: ["latest", undefined],
          expected: "3.0.0",
        },
        {
          label: "the latest available when the target is higher",
          versions: ["1.0.0", "1.1.0"],
          requests: ["3.0.0"],
          expected: "1.1.0",
        },
      ]);
    });

    it("resolves a single tag, which never outranks a semantic version", async () => {
      await expectResolutions([
        // Regression for issue #475: search_docs with no version argument.
        {
          label: "a single tag without an explicit request",
          versions: ["latest"],
          requests: [undefined],
          expected: "latest",
        },
        {
          label: "a single tag beside a semantic version",
          versions: ["1.0.0", "stable"],
          requests: [undefined],
          expected: "1.0.0",
        },
      ]);
    });

    it("reports unversioned documentation, and falls back to it when nothing resolves", async () => {
      await expectResolutions([
        {
          label: "unversioned availability alongside a match",
          versions: ["1.0.0"],
          unversioned: true,
          requests: ["1.0.0"],
          expected: "1.0.0",
        },
        {
          label: "unversioned documentation when nothing resolves",
          versions: [],
          unversioned: true,
          requests: [undefined, "9.9.9"],
          expected: null,
        },
        {
          label: "no match when nothing sits at or below the request",
          versions: ["2.0.0-beta"],
          unversioned: true,
          requests: ["1.20"],
          expected: null,
        },
        {
          label: "an X-range request honoured",
          versions: ["1.0.0", "1.1.0"],
          unversioned: true,
          requests: ["1.0.x"],
          expected: "1.0.0",
        },
        {
          label: "the latest available when the target is higher",
          versions: ["1.0.0", "1.1.0"],
          unversioned: true,
          requests: ["3.0.0"],
          expected: "1.1.0",
        },
        // Ambiguous tags mean no tag resolves, but erroring while the library
        // holds usable unversioned documentation would be worse than handing
        // it back. find_version still reports that no version matched.
        {
          label: "ambiguous tags falling through to unversioned",
          versions: ["stable", "next"],
          unversioned: true,
          requests: [undefined],
          expected: null,
        },
        {
          label: "a prerelease not silently skipped in favour of unversioned",
          versions: ["2.0.0-beta"],
          unversioned: true,
          requests: [undefined],
          expected: "2.0.0-beta",
        },
        // The canonical listing order puts unversioned first, which the web UI
        // uses as its default selection. Resolution answers a different
        // question and picks the newest semantic version.
        {
          label: "unversioned not the default just because it lists first",
          versions: ["1.0.0"],
          unversioned: true,
          requests: [undefined],
          expected: "1.0.0",
        },
        {
          label: "a tag not silently skipped in favour of unversioned",
          versions: ["latest"],
          unversioned: true,
          requests: ["latest"],
          expected: "latest",
        },
        {
          label: "unversioned availability for an unparseable request",
          versions: ["1.0.0"],
          unversioned: true,
          requests: ["not a version!"],
          expected: null,
        },
      ]);
    });

    it("lists every stored label when nothing resolves", async () => {
      const cases: [
        label: string,
        versions: string[],
        request: string | undefined,
        available: string[],
      ][] = [
        [
          "multiple tags, which cannot be ranked",
          ["stable", "next"],
          undefined,
          ["next", "stable"],
        ],
        // Nothing at or below 0.0.1, and "stable" cannot be ranked.
        [
          "a tag beside a version above the request",
          ["1.0.0", "stable"],
          "0.0.1",
          ["1.0.0", "stable"],
        ],
        [
          "an unparseable request when only versions exist",
          ["1.0.0"],
          "not a version!",
          ["1.0.0"],
        ],
        // An unversioned *row* is not unversioned *documentation*: resolution
        // checks for documents, so an empty bucket is no fallback and the
        // ambiguous tags still surface as an error listing the labels.
        [
          "ambiguous tags beside an empty unversioned row",
          ["stable", "next", ""],
          undefined,
          ["", "next", "stable"],
        ],
      ];

      for (const [index, [label, versions, request, available]] of cases.entries()) {
        const library = `unresolved-${index}`;
        await addVersions(library, versions);

        const error = await docService.findBestVersion(library, request).catch((e) => e);

        expect.soft(error, label).toBeInstanceOf(VersionNotFoundInStoreError);
        expect
          .soft(
            error instanceof VersionNotFoundInStoreError
              ? error.availableVersions
              : error,
            label,
          )
          .toEqual(available);
      }
    });

    it("should raise LibraryNotFoundInStoreError when the library is unknown", async () => {
      const library = "test-lib";
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
