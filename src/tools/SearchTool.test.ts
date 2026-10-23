import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  type DocumentManagementService,
  LibraryNotFoundInStoreError,
  VersionNotFoundInStoreError,
} from "../store";
import type { StoreSearchResult } from "../store/types";
import { SearchTool, type SearchToolOptions } from "./SearchTool";

describe("SearchTool", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let searchTool: SearchTool;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDocService = {
      validateLibraryExists: vi.fn(),
      findBestVersion: vi.fn(),
      searchStore: vi.fn(),
      listLibraries: vi.fn(),
    };

    searchTool = new SearchTool(mockDocService as DocumentManagementService);
  });

  const baseOptions: Omit<SearchToolOptions, "version" | "exactMatch" | "limit"> = {
    library: "test-lib",
    query: "test query",
  };

  const mockSearchResults: StoreSearchResult[] = [
    {
      url: "http://example.com/page1",
      content: "Content for result 1",
      score: 0.9,
    },
    {
      url: "http://example.com/page2",
      content: "Content for result 2",
      score: 0.8,
    },
  ];

  it("searches the exact version with the default or given limit", async () => {
    (mockDocService.searchStore as Mock).mockResolvedValue(mockSearchResults);
    const cases: Array<{ label: string; limit?: number; expectedLimit: number }> = [
      { label: "default limit", expectedLimit: 5 },
      { label: "given limit", limit: 10, expectedLimit: 10 },
    ];

    for (const { label, limit, expectedLimit } of cases) {
      const result = await searchTool.execute({
        ...baseOptions,
        version: "1.0.0",
        exactMatch: true,
        limit,
      });

      expect
        .soft(mockDocService.searchStore, label)
        .toHaveBeenLastCalledWith("test-lib", "1.0.0", "test query", expectedLimit);
      expect.soft(result.results, label).toEqual(mockSearchResults);
    }
    expect(mockDocService.findBestVersion).not.toHaveBeenCalled();
  });

  it("refuses an exact match without a version or with 'latest'", async () => {
    (mockDocService.validateLibraryExists as Mock).mockResolvedValue(undefined);
    (mockDocService.listLibraries as Mock).mockResolvedValue([
      {
        library: "test-lib",
        versions: [
          {
            id: 1,
            ref: { library: "test-lib", version: "1.0.0" },
            status: "NOT_INDEXED",
            progress: { pages: 0, maxPages: 1 },
            counts: { documents: 1, uniqueUrls: 1 },
            indexedAt: "2024-01-01T00:00:00Z",
            sourceUrl: null,
          },
        ],
      },
    ]);
    const cases: Array<{ label: string; version?: string }> = [
      { label: "no version" },
      { label: "'latest'", version: "latest" },
    ];

    for (const { label, version } of cases) {
      await expect
        .soft(searchTool.execute({ ...baseOptions, version, exactMatch: true }), label)
        .rejects.toThrow("Version latest for library test-lib not found in store");
    }
    expect(mockDocService.searchStore).not.toHaveBeenCalled();
  });

  it("should name the stored library and its versions when the request uses other casing", async () => {
    (mockDocService.validateLibraryExists as Mock).mockResolvedValue(undefined);
    (mockDocService.listLibraries as Mock).mockResolvedValue([
      {
        library: "React",
        versions: [
          {
            id: 1,
            ref: { library: "React", version: "18.0.0" },
            status: "COMPLETED",
            counts: { documents: 1, uniqueUrls: 1 },
            indexedAt: "2024-01-01T00:00:00Z",
            sourceUrl: null,
          },
        ],
      },
    ]);

    const failure = searchTool.execute({
      library: "react",
      query: "hooks",
      exactMatch: true,
    });

    await expect(failure).rejects.toBeInstanceOf(VersionNotFoundInStoreError);
    await expect(failure).rejects.toMatchObject({
      library: "React",
      availableVersions: ["18.0.0"],
    });
  });

  it("searches the version findBestVersion resolves the request to", async () => {
    (mockDocService.searchStore as Mock).mockResolvedValue(mockSearchResults);
    const cases: Array<{
      label: string;
      version?: string;
      bestMatch: string | null;
      hasUnversioned: boolean;
    }> = [
      { label: "range", version: "1.x", bestMatch: "1.2.0", hasUnversioned: false },
      {
        // searchStore normalizes null to "" and searches the unversioned docs
        label: "no matching version, unversioned docs",
        version: "2.0.0",
        bestMatch: null,
        hasUnversioned: true,
      },
      {
        // Regression for issue #475: a library indexed only as "latest" answered
        // search_docs with "Library not found in store", because the tag never
        // reached the resolver. It now resolves literally and is searched.
        label: "tag",
        bestMatch: "latest",
        hasUnversioned: false,
      },
      {
        // The request is passed through as given: substituting "latest" would make
        // an omitted version match a stored tag literally named "latest".
        label: "omitted version",
        bestMatch: "1.2.0",
        hasUnversioned: false,
      },
    ];

    for (const { label, version, bestMatch, hasUnversioned } of cases) {
      (mockDocService.findBestVersion as Mock).mockResolvedValueOnce({
        bestMatch,
        hasUnversioned,
      });

      const result = await searchTool.execute({ ...baseOptions, version });

      expect
        .soft(mockDocService.findBestVersion, label)
        .toHaveBeenLastCalledWith("test-lib", version);
      expect
        .soft(mockDocService.searchStore, label)
        .toHaveBeenLastCalledWith("test-lib", bestMatch, "test query", 5);
      expect.soft(result.results, label).toEqual(mockSearchResults);
    }
  });

  it("passes a store error on unchanged", async () => {
    const cases: Array<{
      method: "validateLibraryExists" | "findBestVersion" | "searchStore";
      error: Error;
    }> = [
      {
        method: "validateLibraryExists",
        error: new LibraryNotFoundInStoreError("test-lib", ["test-lib-correct"]),
      },
      {
        method: "findBestVersion",
        error: new VersionNotFoundInStoreError("test-lib", "nonexistent", ["1.0.0"]),
      },
      { method: "searchStore", error: new Error("Search index corrupted") },
    ];

    for (const { method, error } of cases) {
      (mockDocService.validateLibraryExists as Mock).mockResolvedValue(undefined);
      (mockDocService.findBestVersion as Mock).mockResolvedValue({
        bestMatch: "1.0.0",
        hasUnversioned: false,
      });
      (mockDocService.searchStore as Mock).mockResolvedValue([]);
      (mockDocService[method] as Mock).mockRejectedValueOnce(error);

      await expect.soft(searchTool.execute(baseOptions), method).rejects.toBe(error);
    }
  });
});
