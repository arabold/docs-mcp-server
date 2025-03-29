import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentManagementService } from "../store";
import type { StoreSearchResult } from "../store/types";
import { logger } from "../utils/logger";
import { SearchTool, type SearchToolOptions } from "./SearchTool";
import { VersionNotFoundError } from "./errors";

// Mock dependencies
vi.mock("../store");
vi.mock("../utils/logger");

describe("SearchTool", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let searchTool: SearchTool;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDocService = {
      findBestVersion: vi.fn(),
      searchStore: vi.fn(),
    };

    searchTool = new SearchTool(mockDocService as DocumentManagementService);
  });

  const baseOptions: Omit<SearchToolOptions, "version" | "exactMatch" | "limit"> = {
    library: "test-lib",
    query: "test query",
  };

  const mockSearchResults: StoreSearchResult[] = [
    { url: "http://example.com/page1", content: "Content for result 1", score: 0.9 },
    { url: "http://example.com/page2", content: "Content for result 2", score: 0.8 },
  ];

  // --- Search Logic & Version Resolution Tests ---

  it("should search with exact version when exactMatch is true", async () => {
    const options: SearchToolOptions = {
      ...baseOptions,
      version: "1.0.0",
      exactMatch: true,
    };
    (mockDocService.searchStore as Mock).mockResolvedValue(mockSearchResults);

    const result = await searchTool.execute(options);

    expect(mockDocService.findBestVersion).not.toHaveBeenCalled();
    expect(mockDocService.searchStore).toHaveBeenCalledWith(
      "test-lib",
      "1.0.0", // Exact version
      "test query",
      5, // Default limit
    );
    expect(result.results).toEqual(mockSearchResults);
    expect(result.error).toBeUndefined();
  });

  it("should find best version and search when exactMatch is false (default)", async () => {
    const options: SearchToolOptions = { ...baseOptions, version: "1.x" };
    const findVersionResult = { bestMatch: "1.2.0", hasUnversioned: false };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(findVersionResult);
    (mockDocService.searchStore as Mock).mockResolvedValue(mockSearchResults);

    const result = await searchTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("test-lib", "1.x");
    expect(mockDocService.searchStore).toHaveBeenCalledWith(
      "test-lib",
      "1.2.0", // Best matched version
      "test query",
      5,
    );
    expect(result.results).toEqual(mockSearchResults);
    expect(result.error).toBeUndefined();
  });

  it("should search unversioned docs if findBestVersion returns null bestMatch but hasUnversioned", async () => {
    const options: SearchToolOptions = { ...baseOptions, version: "2.0.0" }; // Version doesn't exist
    const findVersionResult = { bestMatch: null, hasUnversioned: true };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(findVersionResult);
    (mockDocService.searchStore as Mock).mockResolvedValue(mockSearchResults); // Assume searchStore handles null/"" correctly

    const result = await searchTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("test-lib", "2.0.0");
    // searchStore receives null, which it should normalize to "" for unversioned search
    expect(mockDocService.searchStore).toHaveBeenCalledWith(
      "test-lib",
      null,
      "test query",
      5,
    );
    expect(result.results).toEqual(mockSearchResults);
    expect(result.error).toBeUndefined();
  });

  it("should use 'latest' for findBestVersion if version is omitted and exactMatch is false", async () => {
    const options: SearchToolOptions = { ...baseOptions }; // No version
    const findVersionResult = { bestMatch: "1.2.0", hasUnversioned: false };
    (mockDocService.findBestVersion as Mock).mockResolvedValue(findVersionResult);
    (mockDocService.searchStore as Mock).mockResolvedValue(mockSearchResults);

    await searchTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith("test-lib", "latest"); // Default version
    expect(mockDocService.searchStore).toHaveBeenCalledWith(
      "test-lib",
      "1.2.0",
      "test query",
      5,
    );
  });

  // --- Limit Handling ---

  it("should use the specified limit", async () => {
    const options: SearchToolOptions = {
      ...baseOptions,
      version: "1.0.0",
      exactMatch: true,
      limit: 10,
    };
    (mockDocService.searchStore as Mock).mockResolvedValue([]);

    await searchTool.execute(options);

    expect(mockDocService.searchStore).toHaveBeenCalledWith(
      "test-lib",
      "1.0.0",
      "test query",
      10, // Specified limit
    );
  });

  // --- Error Handling & Result Structure ---

  it("should return error structure when VersionNotFoundError occurs", async () => {
    const options: SearchToolOptions = { ...baseOptions, version: "nonexistent" };
    const available = [{ version: "1.0.0", indexed: true }];
    const error = new VersionNotFoundError("test-lib", "nonexistent", available);
    (mockDocService.findBestVersion as Mock).mockRejectedValue(error);

    const result = await searchTool.execute(options);

    expect(mockDocService.findBestVersion).toHaveBeenCalledWith(
      "test-lib",
      "nonexistent",
    );
    expect(mockDocService.searchStore).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("Version nonexistent not found");
    expect(result.error?.availableVersions).toEqual(available);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Version not found"),
    );
  });

  it("should re-throw unexpected errors from findBestVersion", async () => {
    const options: SearchToolOptions = { ...baseOptions, version: "1.x" };
    const unexpectedError = new Error("Store connection failed");
    (mockDocService.findBestVersion as Mock).mockRejectedValue(unexpectedError);

    await expect(searchTool.execute(options)).rejects.toThrow("Store connection failed");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Search failed: Store connection failed"),
    );
  });

  it("should re-throw unexpected errors from searchStore", async () => {
    const options: SearchToolOptions = {
      ...baseOptions,
      version: "1.0.0",
      exactMatch: true,
    };
    const unexpectedError = new Error("Search index corrupted");
    (mockDocService.searchStore as Mock).mockRejectedValue(unexpectedError);

    await expect(searchTool.execute(options)).rejects.toThrow("Search index corrupted");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Search failed: Search index corrupted"),
    );
  });
});
