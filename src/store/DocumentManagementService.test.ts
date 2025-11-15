import path from "node:path";
import { createFsFromVolume, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryNotFoundInStoreError, VersionNotFoundInStoreError } from "./errors";

vi.mock("node:fs", () => ({
  default: createFsFromVolume(vol),
  existsSync: vi.fn(vol.existsSync),
}));
vi.mock("../utils/paths", () => ({
  getProjectRoot: vi.fn(() => "/docs-mcp-server"),
}));

// Mock env-paths using mockImplementation
const mockEnvPaths = { data: "/mock/env/path/data" };
const mockEnvPathsFn = vi.fn().mockReturnValue(mockEnvPaths); // Keep the spy/implementation separate
vi.mock("env-paths", () => ({
  // Mock with a placeholder function initially
  default: vi.fn(),
}));

import envPaths from "env-paths";

// Assign the actual implementation to the mocked function
vi.mocked(envPaths).mockImplementation(mockEnvPathsFn);

// Define the instance methods mock
const mockStore = {
  initialize: vi.fn(),
  shutdown: vi.fn(),
  queryUniqueVersions: vi.fn(),
  checkDocumentExists: vi.fn(),
  queryLibraryVersions: vi.fn().mockResolvedValue(new Map<string, any[]>()),
  addDocuments: vi.fn(),
  deletePages: vi.fn(),
  // Status tracking methods
  updateVersionStatus: vi.fn(),
  updateVersionProgress: vi.fn(),
  getVersionsByStatus: vi.fn(),
  // Scraper options methods
  storeScraperOptions: vi.fn(),
  getScraperOptions: vi.fn(),
  findVersionsBySourceUrl: vi.fn(),
  resolveVersionId: vi.fn(),
};

// Mock the DocumentStore module
vi.mock("./DocumentStore", () => {
  // Create the mock constructor *inside* the factory function
  const MockDocumentStore = vi.fn(() => mockStore);
  return { DocumentStore: MockDocumentStore };
});

import { getProjectRoot } from "../utils/paths";
// Import the mocked constructor AFTER vi.mock
import { DocumentManagementService } from "./DocumentManagementService";

// Mock DocumentRetrieverService (keep existing structure)
const mockRetriever = {
  search: vi.fn(),
};

vi.mock("./DocumentRetrieverService", () => ({
  DocumentRetrieverService: vi.fn().mockImplementation(() => mockRetriever),
}));

// Mock DocumentManagementClient for factory tests
const mockClientInitialize = vi.fn().mockResolvedValue(undefined);
const MockDocumentManagementClient = vi
  .fn()
  .mockImplementation((_url: string) => ({ initialize: mockClientInitialize }));

vi.mock("./DocumentManagementClient", () => ({
  DocumentManagementClient: MockDocumentManagementClient,
}));

// --- END MOCKS ---

describe("DocumentManagementService", () => {
  let docService: DocumentManagementService; // For general tests
  const projectRoot = getProjectRoot();

  // Define expected paths consistently using the calculated actual root
  // Note: getProjectRoot() called here will now run *after* fs is mocked,
  // so it needs the dummy package.json created in beforeEach.
  const _expectedOldDbPath = path.join(projectRoot, ".store", "documents.db");
  const _expectedStandardDbPath = path.join(mockEnvPaths.data, "documents.db");

  beforeEach(() => {
    vi.clearAllMocks();
    vol.reset(); // Reset memfs

    // --- Create dummy package.json in memfs for getProjectRoot() ---
    // Ensure the calculated project root directory exists in memfs
    vol.mkdirSync(projectRoot, { recursive: true });
    // Create a dummy package.json file there
    vol.writeFileSync(path.join(projectRoot, "package.json"), "{}");
    // -------------------------------------------------------------

    // Ensure envPaths mock is reset/set for general tests
    mockEnvPathsFn.mockReturnValue(mockEnvPaths);

    // Set OPENAI_API_KEY for tests to enable default embedding behavior
    process.env.OPENAI_API_KEY = "test-api-key";

    // Initialize the main service instance used by most tests
    // This will now use memfs for its internal fs calls
    docService = new DocumentManagementService("/test/store/path");
  });

  afterEach(async () => {
    // Shutdown the main service instance
    await docService?.shutdown();
  });

  // --- Pipeline Configuration Tests ---
  describe("Pipeline Configuration", () => {
    beforeEach(() => {
      vol.reset(); // Reset memfs volume before each test
      vi.clearAllMocks(); // Clear other mocks
    });

    it("should accept pipeline configuration and pass it to factory", () => {
      const pipelineConfig = {
        chunkSizes: {
          preferred: 800,
          max: 1600,
        },
      };

      const service = new DocumentManagementService("/test/path", null, pipelineConfig);
      expect(service).toBeInstanceOf(DocumentManagementService);
      // Test passes if no errors are thrown during construction
    });

    it("should work without pipeline configuration", () => {
      const service = new DocumentManagementService("/test/path");
      expect(service).toBeInstanceOf(DocumentManagementService);
      // Test passes if no errors are thrown during construction
    });

    it("should work with only embedding config provided", () => {
      const service = new DocumentManagementService("/test/path", null);
      expect(service).toBeInstanceOf(DocumentManagementService);
    });

    it("should work with both embedding and pipeline config", () => {
      const pipelineConfig = { chunkSizes: { preferred: 500 } };
      const service = new DocumentManagementService("/test/path", null, pipelineConfig);
      expect(service).toBeInstanceOf(DocumentManagementService);
    });
  });

  // --- ensureVersion tests ---
  describe("ensureVersion", () => {
    it("creates library and version when both absent", async () => {
      mockStore.resolveVersionId.mockResolvedValue(10);
      const id = await docService.ensureVersion({ library: "React", version: "18.2.0" });
      expect(id).toBe(10);
      // ensure normalize to lowercase
      expect(mockStore.resolveVersionId).toHaveBeenCalledWith("react", "18.2.0");
    });

    it("handles unversioned refs (empty version string)", async () => {
      mockStore.resolveVersionId.mockResolvedValue(20);
      const id = await docService.ensureVersion({ library: "Lodash", version: "" });
      expect(id).toBe(20);
      expect(mockStore.resolveVersionId).toHaveBeenCalledWith("lodash", "");
    });

    it("trims whitespace and normalizes version", async () => {
      mockStore.resolveVersionId.mockResolvedValue(30);
      const id = await docService.ensureVersion({
        library: "  Express  ",
        version: "  ",
      });
      expect(id).toBe(30);
      expect(mockStore.resolveVersionId).toHaveBeenCalledWith("express", "");
    });

    it("reuses single unversioned version across multiple ensureVersion calls (regression)", async () => {
      // simulate same returned id each time
      mockStore.resolveVersionId
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(10);
      const a = await docService.ensureVersion({ library: "TestLib", version: "" });
      const b = await docService.ensureVersion({ library: "TestLib", version: "" });
      const c = await docService.ensureVersion({ library: "TestLib", version: "" });
      expect(a).toBe(10);
      expect(b).toBe(10);
      expect(c).toBe(10);
      expect(mockStore.resolveVersionId).toHaveBeenCalledTimes(3);
    });
  });

  // --- Factory function behavior tests ---
  describe("DocumentManagement factory functions", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("createDocumentManagement() returns initialized local service by default", async () => {
      const initSpy = vi.spyOn(DocumentManagementService.prototype, "initialize");
      const { createDocumentManagement } = await import("./index");

      const dm = await createDocumentManagement({ storePath: "/test/path" });

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(dm).toBeInstanceOf(DocumentManagementService);
      // Should not construct remote client when no serverUrl is provided
      expect(MockDocumentManagementClient).not.toHaveBeenCalled();
    });

    it("createDocumentManagement({serverUrl}) returns initialized remote client", async () => {
      const { createDocumentManagement } = await import("./index");
      const url = "http://localhost:8080";

      const dm = await createDocumentManagement({ serverUrl: url });

      expect(MockDocumentManagementClient).toHaveBeenCalledWith(url);
      expect(mockClientInitialize).toHaveBeenCalledTimes(1);
      // Not a local service instance
      expect(dm).not.toBeInstanceOf(DocumentManagementService);
    });

    it("createLocalDocumentManagement() returns initialized local service", async () => {
      const initSpy = vi.spyOn(DocumentManagementService.prototype, "initialize");
      const { createLocalDocumentManagement } = await import("./index");

      const dm = await createLocalDocumentManagement("/test/path");

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(dm).toBeInstanceOf(DocumentManagementService);
      // Should never touch remote client in local helper
      expect(MockDocumentManagementClient).not.toHaveBeenCalled();
    });
  });
  // --- END: Constructor Path Logic Tests ---

  // --- Existing Tests (Rely on global docService and mocks) ---
  // Grouped existing tests for clarity
  describe("Initialization and Shutdown", () => {
    it("should initialize correctly", async () => {
      // Uses global docService initialized in beforeEach
      await docService.initialize();
      expect(mockStore.initialize).toHaveBeenCalled();
    });

    it("should shutdown correctly", async () => {
      // Uses global docService initialized in beforeEach
      await docService.shutdown();
      expect(mockStore.shutdown).toHaveBeenCalled();
    });
  });

  describe("Core Functionality", () => {
    // Uses global docService initialized in beforeEach

    it("should handle empty store existence check", async () => {
      mockStore.checkDocumentExists.mockResolvedValue(false); // Use mockStoreInstance
      const exists = await docService.exists("test-lib", "1.0.0");
      expect(exists).toBe(false);
      expect(mockStore.checkDocumentExists).toHaveBeenCalledWith("test-lib", "1.0.0");
    });

    it("should remove all documents for a specific library and version", async () => {
      const library = "test-lib";
      const version = "1.0.0";

      await docService.removeAllDocuments(library, version);
      expect(mockStore.deletePages).toHaveBeenCalledWith(library, version); // Fix: Use mockStoreInstance
    });

    it("should handle removing documents with null/undefined/empty version", async () => {
      const library = "test-lib";
      await docService.removeAllDocuments(library, null);
      expect(mockStore.deletePages).toHaveBeenCalledWith(library, ""); // Fix: Use mockStoreInstance
      await docService.removeAllDocuments(library, undefined);
      expect(mockStore.deletePages).toHaveBeenCalledWith(library, ""); // Fix: Use mockStoreInstance
      await docService.removeAllDocuments(library, "");
      expect(mockStore.deletePages).toHaveBeenCalledWith(library, ""); // Fix: Use mockStoreInstance
    });

    describe("listVersions", () => {
      it("should return an empty array if the library has no documents", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue([]); // Fix: Use mockStoreInstance
        const versions = await docService.listVersions("nonexistent-lib");
        expect(versions).toEqual([]);
      });

      it("should return an array versions", async () => {
        const library = "test-lib";
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "1.1.0", "1.2.0"]); // Fix: Use mockStoreInstance

        const versions = await docService.listVersions(library);
        expect(versions).toEqual(["1.0.0", "1.1.0", "1.2.0"]);
        expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library); // Fix: Use mockStoreInstance
      });

      it("should filter out empty string and non-semver versions", async () => {
        const library = "test-lib";
        mockStore.queryUniqueVersions.mockResolvedValue([
          // Fix: Use mockStoreInstance
          "1.0.0",
          "",
          "invalid-version",
          "2.0.0-beta", // Valid semver, should be included
          "2.0.0",
        ]);

        const versions = await docService.listVersions(library);
        expect(versions).toEqual(["1.0.0", "2.0.0-beta", "2.0.0"]);
        expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library); // Fix: Use mockStoreInstance
      });
    });

    describe("findBestVersion", () => {
      const library = "test-lib";

      beforeEach(() => {
        // Reset mocks for checkDocumentExists for each test
        mockStore.checkDocumentExists.mockResolvedValue(false); // Fix: Use mockStoreInstance
      });

      it("should return best match and hasUnversioned=false when only semver exists", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "1.1.0", "2.0.0"]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned // Fix: Use mockStoreInstance

        const result = await docService.findBestVersion(library, "1.5.0");
        expect(result).toEqual({ bestMatch: "1.1.0", hasUnversioned: false });
        expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library); // Fix: Use mockStoreInstance
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, ""); // Fix: Use mockStoreInstance
      });

      it("should return latest match and hasUnversioned=false for 'latest'", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "2.0.0", "3.0.0"]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // Fix: Use mockStoreInstance

        const latestResult = await docService.findBestVersion(library, "latest");
        expect(latestResult).toEqual({ bestMatch: "3.0.0", hasUnversioned: false });

        const defaultResult = await docService.findBestVersion(library); // No target version
        expect(defaultResult).toEqual({ bestMatch: "3.0.0", hasUnversioned: false });
      });

      it("should return best match and hasUnversioned=true when both exist", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "1.1.0"]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(true); // Unversioned exists // Fix: Use mockStoreInstance

        const result = await docService.findBestVersion(library, "1.0.x");
        expect(result).toEqual({ bestMatch: "1.0.0", hasUnversioned: true });
      });

      it("should return latest match and hasUnversioned=true when both exist (latest)", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "2.0.0"]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(true); // Fix: Use mockStoreInstance

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: "2.0.0", hasUnversioned: true });
      });

      it("should return null bestMatch and hasUnversioned=true when only unversioned exists", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue([""]); // listVersions filters this out // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(true); // Unversioned exists // Fix: Use mockStoreInstance

        const result = await docService.findBestVersion(library);
        expect(result).toEqual({ bestMatch: null, hasUnversioned: true });

        const resultSpecific = await docService.findBestVersion(library, "1.0.0");
        expect(resultSpecific).toEqual({ bestMatch: null, hasUnversioned: true });
      });

      it("should return fallback match and hasUnversioned=true when target is higher but unversioned exists", async () => {
        // Renamed test for clarity
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "1.1.0"]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(true); // Unversioned exists // Fix: Use mockStoreInstance

        const result = await docService.findBestVersion(library, "3.0.0"); // Target higher than available
        // Expect fallback to latest available (1.1.0) because a version was requested
        expect(result).toEqual({ bestMatch: "1.1.0", hasUnversioned: true }); // Corrected expectation
      });

      it("should return fallback match and hasUnversioned=false when target is higher and only semver exists", async () => {
        // New test for specific corner case
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0", "1.1.0"]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned // Fix: Use mockStoreInstance

        const result = await docService.findBestVersion(library, "3.0.0"); // Target higher than available
        // Expect fallback to latest available (1.1.0)
        expect(result).toEqual({ bestMatch: "1.1.0", hasUnversioned: false });
      });

      it("should throw LibraryNotFoundInStoreError when no versions (semver or unversioned) exist", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue([]); // No semver // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned // Fix: Use mockStoreInstance

        await expect(docService.findBestVersion(library, "1.0.0")).rejects.toThrow(
          LibraryNotFoundInStoreError,
        );
        await expect(docService.findBestVersion(library)).rejects.toThrow(
          LibraryNotFoundInStoreError,
        );

        // Check error details
        const error = (await docService
          .findBestVersion(library)
          .catch((e) => e)) as LibraryNotFoundInStoreError;
        expect(error).toBeInstanceOf(LibraryNotFoundInStoreError);
        expect(error.library).toBe(library);
        expect(error.similarLibraries).toEqual([]); // No similar libraries in this mock setup
      });

      it("should not throw for invalid target version format if unversioned exists", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0"]); // Has semver // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(true); // Has unversioned // Fix: Use mockStoreInstance

        // Invalid format, but unversioned exists, so should return null match
        const result = await docService.findBestVersion(library, "invalid-format");
        expect(result).toEqual({ bestMatch: null, hasUnversioned: true });
      });

      it("should throw VersionNotFoundInStoreError for invalid target version format if only semver exists", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0"]); // Has semver // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned // Fix: Use mockStoreInstance

        // Invalid format, no unversioned fallback -> throw
        await expect(
          docService.findBestVersion(library, "invalid-format"),
        ).rejects.toThrow(VersionNotFoundInStoreError);
      });
    });

    describe("listLibraries", () => {
      it("should list libraries with enriched version metadata", async () => {
        const mockLibraryMap = new Map([
          [
            "lib1",
            [
              {
                version: "1.0.0",
                versionId: 101,
                status: "completed",
                progressPages: 10,
                progressMaxPages: 10,
                sourceUrl: null,
                documentCount: 10,
                uniqueUrlCount: 5,
                indexedAt: "2024-01-01T00:00:00.000Z",
              },
              {
                version: "1.1.0",
                versionId: 102,
                status: "completed",
                progressPages: 15,
                progressMaxPages: 15,
                sourceUrl: null,
                documentCount: 15,
                uniqueUrlCount: 7,
                indexedAt: "2024-02-01T00:00:00.000Z",
              },
            ],
          ],
          [
            "lib2",
            [
              {
                version: "2.0.0",
                versionId: 201,
                status: "completed",
                progressPages: 20,
                progressMaxPages: 20,
                sourceUrl: null,
                documentCount: 20,
                uniqueUrlCount: 10,
                indexedAt: "2024-03-01T00:00:00.000Z",
              },
            ],
          ],
          [
            "unversioned-only",
            [
              {
                version: "",
                versionId: 300,
                status: "completed",
                progressPages: 1,
                progressMaxPages: 1,
                sourceUrl: null,
                documentCount: 1,
                uniqueUrlCount: 1,
                indexedAt: "2024-04-01T00:00:00.000Z",
              },
            ],
          ],
          [
            "mixed-versions",
            [
              {
                version: "",
                versionId: 400,
                status: "completed",
                progressPages: 2,
                progressMaxPages: 2,
                sourceUrl: null,
                documentCount: 2,
                uniqueUrlCount: 1,
                indexedAt: "2024-04-03T00:00:00.000Z",
              },
              {
                version: "1.0.0",
                versionId: 401,
                status: "completed",
                progressPages: 5,
                progressMaxPages: 5,
                sourceUrl: null,
                documentCount: 5,
                uniqueUrlCount: 2,
                indexedAt: "2024-04-02T00:00:00.000Z",
              },
            ],
          ],
        ] as any);
        mockStore.queryLibraryVersions.mockResolvedValue(mockLibraryMap as any);

        const result = await docService.listLibraries();
        expect(
          result.map((r) => ({
            library: r.library,
            versions: r.versions.map((v) => ({
              ref: v.ref,
              status: v.status,
              counts: v.counts,
              indexedAt: v.indexedAt,
            })),
          })),
        ).toEqual([
          {
            library: "lib1",
            versions: [
              {
                ref: { library: "lib1", version: "1.0.0" },
                status: "completed",
                counts: { documents: 10, uniqueUrls: 5 },
                indexedAt: "2024-01-01T00:00:00.000Z",
              },
              {
                ref: { library: "lib1", version: "1.1.0" },
                status: "completed",
                counts: { documents: 15, uniqueUrls: 7 },
                indexedAt: "2024-02-01T00:00:00.000Z",
              },
            ],
          },
          {
            library: "lib2",
            versions: [
              {
                ref: { library: "lib2", version: "2.0.0" },
                status: "completed",
                counts: { documents: 20, uniqueUrls: 10 },
                indexedAt: "2024-03-01T00:00:00.000Z",
              },
            ],
          },
          {
            library: "unversioned-only",
            versions: [
              {
                ref: { library: "unversioned-only", version: "" },
                status: "completed",
                counts: { documents: 1, uniqueUrls: 1 },
                indexedAt: "2024-04-01T00:00:00.000Z",
              },
            ],
          },
          {
            library: "mixed-versions",
            versions: [
              {
                ref: { library: "mixed-versions", version: "" },
                status: "completed",
                counts: { documents: 2, uniqueUrls: 1 },
                indexedAt: "2024-04-03T00:00:00.000Z",
              },
              {
                ref: { library: "mixed-versions", version: "1.0.0" },
                status: "completed",
                counts: { documents: 5, uniqueUrls: 2 },
                indexedAt: "2024-04-02T00:00:00.000Z",
              },
            ],
          },
        ]);
        expect(mockStore.queryLibraryVersions).toHaveBeenCalledTimes(1);
      });

      it("should return an empty array if there are no libraries", async () => {
        // Mock returns an empty map of the correct type
        mockStore.queryLibraryVersions.mockResolvedValue(
          new Map<
            string,
            Array<{
              version: string;
              documentCount: number;
              uniqueUrlCount: number;
              indexedAt: string | null;
            }>
          >(),
        );
        const result = await docService.listLibraries();
        expect(result).toEqual([]);
        expect(mockStore.queryLibraryVersions).toHaveBeenCalledTimes(1);
      });

      // Test case where store returns a library that only had an unversioned entry
      // (which is now included, not filtered by the store)
      it("should correctly handle libraries with only unversioned entries", async () => {
        const mockLibraryMap = new Map([
          [
            "lib-unversioned",
            [
              {
                version: "",
                versionId: 999,
                status: "completed",
                progressPages: 0,
                progressMaxPages: 0,
                sourceUrl: null,
                documentCount: 3,
                uniqueUrlCount: 2,
                indexedAt: "2024-04-04T00:00:00.000Z",
              },
            ],
          ],
        ] as any);
        mockStore.queryLibraryVersions.mockResolvedValue(mockLibraryMap as any);

        const result = await docService.listLibraries();
        expect(result).toEqual([
          {
            library: "lib-unversioned",
            versions: [
              {
                id: 999,
                ref: { library: "lib-unversioned", version: "" },
                status: "completed",
                counts: { documents: 3, uniqueUrls: 2 },
                indexedAt: "2024-04-04T00:00:00.000Z",
                sourceUrl: undefined,
              },
            ],
          },
        ]);
        expect(result[0].versions[0].progress).toBeUndefined();
        expect(mockStore.queryLibraryVersions).toHaveBeenCalledTimes(1);
      });
    });

    // Tests for handling optional version parameter (null/undefined/"")
    describe("Optional Version Handling", () => {
      const library = "opt-lib";
      const query = "optional";

      it("exists should normalize version to empty string", async () => {
        await docService.exists(library, null);
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, "");
        await docService.exists(library, undefined);
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, "");
        await docService.exists(library, "");
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(library, "");
      });

      it("searchStore should normalize version to empty string", async () => {
        // Call without explicit limit, should use default limit of 5
        await docService.searchStore(library, null, query);
        expect(mockRetriever.search).toHaveBeenCalledWith(library, "", query, 5);

        // Call with explicit limit
        await docService.searchStore(library, undefined, query, 7);
        expect(mockRetriever.search).toHaveBeenCalledWith(library, "", query, 7);

        // Call with another explicit limit
        await docService.searchStore(library, "", query, 10);
        expect(mockRetriever.search).toHaveBeenCalledWith(library, "", query, 10);
      });
    });

    describe("validateLibraryExists", () => {
      const library = "test-lib";
      const existingLibraries = [
        { library: "test-lib", versions: [{ version: "1.0.0", indexed: true }] },
        { library: "another-lib", versions: [{ version: "2.0.0", indexed: true }] },
        { library: "react", versions: [] },
      ];

      it("should resolve successfully if versioned documents exist", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue(["1.0.0"]); // Has versioned docs // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // No unversioned docs // Fix: Use mockStoreInstance

        await expect(docService.validateLibraryExists(library)).resolves.toBeUndefined();
        expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library.toLowerCase()); // Fix: Use mockStoreInstance
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(
          // Fix: Use mockStoreInstance
          library.toLowerCase(),
          "",
        );
      });

      it("should resolve successfully if only unversioned documents exist", async () => {
        mockStore.queryUniqueVersions.mockResolvedValue([]); // No versioned docs // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(true); // Has unversioned docs // Fix: Use mockStoreInstance

        await expect(docService.validateLibraryExists(library)).resolves.toBeUndefined();
        expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(library.toLowerCase()); // Fix: Use mockStoreInstance
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(
          // Fix: Use mockStoreInstance
          library.toLowerCase(),
          "",
        );
      });

      it("should throw LibraryNotFoundInStoreError if library does not exist (no suggestions)", async () => {
        const nonExistentLibrary = "non-existent-lib";
        mockStore.queryUniqueVersions.mockResolvedValue([]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // Fix: Use mockStoreInstance
        mockStore.queryLibraryVersions.mockResolvedValue(new Map()); // No libraries exist at all // Fix: Use mockStoreInstance

        await expect(
          docService.validateLibraryExists(nonExistentLibrary),
        ).rejects.toThrow(LibraryNotFoundInStoreError);

        const error = (await docService
          .validateLibraryExists(nonExistentLibrary)
          .catch((e) => e)) as LibraryNotFoundInStoreError;
        expect(error).toBeInstanceOf(LibraryNotFoundInStoreError);
        expect(error.library).toBe(nonExistentLibrary);
        expect(error.similarLibraries).toEqual([]);
        expect(mockStore.queryLibraryVersions).toHaveBeenCalled(); // Ensure it tried to get suggestions // Fix: Use mockStoreInstance
      });

      it("should throw LibraryNotFoundInStoreError with suggestions if library does not exist", async () => {
        const misspelledLibrary = "reac"; // Misspelled 'react'
        mockStore.queryUniqueVersions.mockResolvedValue([]); // Fix: Use mockStoreInstance
        mockStore.checkDocumentExists.mockResolvedValue(false); // Fix: Use mockStoreInstance
        // Mock listLibraries to return existing libraries
        const mockLibraryMap = new Map<
          string,
          Array<{
            version: string;
            documentCount: number;
            uniqueUrlCount: number;
            indexedAt: string | null;
          }>
        >(
          existingLibraries.map((l) => [
            l.library,
            l.versions.map((v) => ({
              version: v.version,
              documentCount: 0,
              uniqueUrlCount: 0,
              indexedAt: null,
            })),
          ]),
        );
        mockStore.queryLibraryVersions.mockResolvedValue(mockLibraryMap);

        await expect(docService.validateLibraryExists(misspelledLibrary)).rejects.toThrow(
          LibraryNotFoundInStoreError,
        );

        const error = (await docService
          .validateLibraryExists(misspelledLibrary)
          .catch((e) => e)) as LibraryNotFoundInStoreError;
        expect(error).toBeInstanceOf(LibraryNotFoundInStoreError);
        expect(error.library).toBe(misspelledLibrary);
        expect(error.similarLibraries).toEqual(["react"]); // Expect 'react' as suggestion
        expect(mockStore.queryLibraryVersions).toHaveBeenCalled(); // Fix: Use mockStoreInstance
      });

      it("should handle case insensitivity", async () => {
        const libraryUpper = "TEST-LIB";
        const libraryLower = libraryUpper.toLowerCase(); // 'test-lib'

        // Mock the store to indicate the LOWERCASE library exists
        mockStore.queryUniqueVersions.mockImplementation(async (lib) =>
          lib === libraryLower ? ["1.0.0"] : [],
        );
        // Alternatively, or additionally, mock checkDocumentExists:
        // mockStore.checkDocumentExists.mockImplementation(async (lib, ver) =>
        //   lib === libraryLower && ver === "" ? true : false
        // );

        // Should still resolve because the service normalizes the input
        await expect(
          docService.validateLibraryExists(libraryUpper),
        ).resolves.toBeUndefined();

        // Verify the mocks were called with the LOWERCASE name
        expect(mockStore.queryUniqueVersions).toHaveBeenCalledWith(libraryLower);
        expect(mockStore.checkDocumentExists).toHaveBeenCalledWith(libraryLower, "");
      });
    });

    describe("Pipeline Integration Methods", () => {
      it("should delegate status tracking to store", async () => {
        const versionId = 123;
        const status = "queued";
        const errorMessage = "Test error";

        // Test updateVersionStatus
        await docService.updateVersionStatus(versionId, status as any, errorMessage);
        expect(mockStore.updateVersionStatus).toHaveBeenCalledWith(
          versionId,
          status,
          errorMessage,
        );

        // Test updateVersionProgress
        await docService.updateVersionProgress(versionId, 5, 10);
        expect(mockStore.updateVersionProgress).toHaveBeenCalledWith(versionId, 5, 10);

        // Test getVersionsByStatus
        mockStore.getVersionsByStatus.mockResolvedValue([]);
        await docService.getVersionsByStatus(["queued"] as any);
        expect(mockStore.getVersionsByStatus).toHaveBeenCalledWith(["queued"]);

        // Test getVersionsByStatus (legacy running replacement)
        mockStore.getVersionsByStatus.mockResolvedValue([]);
        await docService.getVersionsByStatus(["running"] as any);
        expect(mockStore.getVersionsByStatus).toHaveBeenCalledWith(["running"]);

        // Test getVersionsByStatus (legacy active replacement)
        mockStore.getVersionsByStatus.mockResolvedValue([]);
        await docService.getVersionsByStatus(["queued", "running", "updating"] as any);
        expect(mockStore.getVersionsByStatus).toHaveBeenCalledWith([
          "queued",
          "running",
          "updating",
        ]);
      });

      it("should delegate scraper options storage to store", async () => {
        const versionId = 456;
        const scraperOptions = {
          url: "https://example.com",
          library: "testlib",
          version: "1.0.0",
          maxDepth: 3,
          maxPages: 100,
        };

        // Test storeScraperOptions
        await docService.storeScraperOptions(versionId, scraperOptions);
        expect(mockStore.storeScraperOptions).toHaveBeenCalledWith(
          versionId,
          scraperOptions,
        );

        // Test getScraperOptions
        mockStore.getScraperOptions.mockResolvedValue(null);
        await docService.getScraperOptions(versionId);
        expect(mockStore.getScraperOptions).toHaveBeenCalledWith(versionId);

        // Test findVersionsBySourceUrl
        const sourceUrl = "https://docs.example.com";
        mockStore.findVersionsBySourceUrl.mockResolvedValue([]);
        await docService.findVersionsBySourceUrl(sourceUrl);
        expect(mockStore.findVersionsBySourceUrl).toHaveBeenCalledWith(sourceUrl);
      });

      it("should ensure library and version creation", async () => {
        const library = "NewLib";
        const version = "2.0.0";
        const expectedVersionId = 789;

        // Mock the store method
        mockStore.resolveVersionId.mockResolvedValue(expectedVersionId);

        const result = await docService.ensureLibraryAndVersion(library, version);

        // Should normalize library name to lowercase and version
        expect(mockStore.resolveVersionId).toHaveBeenCalledWith("newlib", "2.0.0");
        expect(result).toBe(expectedVersionId);
      });

      it("should handle version normalization in scraper methods", async () => {
        const versionId = 999;
        mockStore.getScraperOptions
          .mockResolvedValueOnce({ sourceUrl: "https://a", options: {} as any })
          .mockResolvedValueOnce({ sourceUrl: "https://b", options: {} as any });

        const result1 = await docService.getScraperOptions(versionId);
        const result2 = await docService.getScraperOptions(versionId);

        expect(result1?.sourceUrl).toEqual("https://a");
        expect(result2?.sourceUrl).toEqual("https://b");
        expect(mockStore.getScraperOptions).toHaveBeenCalledTimes(2);
      });
    });

    describe("getScraperOptions (service wrapper)", () => {
      it("should return stored object then null on subsequent call (combined happy/null path)", async () => {
        const versionId = 42;
        const stored = {
          sourceUrl: "https://docs.example.com",
          options: { maxDepth: 5 },
        };
        mockStore.getScraperOptions
          .mockResolvedValueOnce(stored)
          .mockResolvedValueOnce(null);

        const first = await docService.getScraperOptions(versionId);
        const second = await docService.getScraperOptions(versionId);
        expect(first).toEqual(stored);
        expect(second).toBeNull();
        expect(mockStore.getScraperOptions).toHaveBeenNthCalledWith(1, versionId);
        expect(mockStore.getScraperOptions).toHaveBeenNthCalledWith(2, versionId);
      });
    });

    describe("listLibraries (enriched summaries)", () => {
      it("returns empty array when no libraries", async () => {
        mockStore.queryLibraryVersions.mockResolvedValue(new Map());
        mockStore.getVersionsByStatus.mockResolvedValue([]);
        const result = await docService.listLibraries();
        expect(result).toEqual([]);
      });

      it("passes through multiple statuses and progress fields for enriched rows", async () => {
        const enrichedMap = new Map<string, any[]>([
          [
            "libStatus",
            [
              {
                version: "1.0.0",
                versionId: 11,
                status: "completed",
                progressPages: 10,
                progressMaxPages: 10,
                sourceUrl: "https://ex/libStatus/1.0.0",
                documentCount: 50,
                uniqueUrlCount: 45,
                indexedAt: "2024-02-01T00:00:00.000Z",
              },
              {
                version: "1.1.0",
                versionId: 12,
                status: "failed",
                progressPages: 3,
                progressMaxPages: 8,
                sourceUrl: "https://ex/libStatus/1.1.0",
                documentCount: 12,
                uniqueUrlCount: 10,
                indexedAt: null,
              },
              {
                version: "2.0.0",
                versionId: 13,
                status: "cancelled",
                progressPages: 5,
                progressMaxPages: 20,
                sourceUrl: null,
                documentCount: 0,
                uniqueUrlCount: 0,
                indexedAt: null,
              },
              {
                version: "",
                versionId: 14,
                status: "not_indexed",
                progressPages: 0,
                progressMaxPages: 0,
                sourceUrl: null,
                documentCount: 0,
                uniqueUrlCount: 0,
                indexedAt: null,
              },
            ],
          ],
        ]);
        mockStore.queryLibraryVersions.mockResolvedValue(enrichedMap);

        const result = await docService.listLibraries();
        const lib = result.find((r) => r.library === "libStatus");
        expect(lib).toBeTruthy();
        const byVer = Object.fromEntries(
          lib!.versions.map((v) => [v.ref.version || "__unver__", v]),
        );
        expect(byVer["1.0.0"]).toMatchObject({
          status: "completed",
          // progress omitted for completed
        });
        expect(byVer["1.1.0"]).toMatchObject({
          status: "failed",
          progress: { pages: 3, maxPages: 8 },
        });
        expect(byVer["2.0.0"]).toMatchObject({
          status: "cancelled",
          progress: { pages: 5, maxPages: 20 },
        });
        expect(byVer.__unver__).toMatchObject({
          status: "not_indexed",
          progress: { pages: 0, maxPages: 0 },
        });
        // Explicitly ensure progress is undefined for completed version
        expect(byVer["1.0.0"].progress).toBeUndefined();
      });

      it("omits progress for completed versions but includes for active ones", async () => {
        const enrichedMap = new Map<string, any[]>([
          [
            "libActive",
            [
              {
                version: "1.0.0",
                versionId: 21,
                status: "completed",
                progressPages: 5,
                progressMaxPages: 5,
                sourceUrl: null,
                documentCount: 10,
                uniqueUrlCount: 9,
                indexedAt: "2024-05-01T00:00:00.000Z",
              },
              {
                version: "1.1.0",
                versionId: 22,
                status: "running",
                progressPages: 2,
                progressMaxPages: 10,
                sourceUrl: null,
                documentCount: 4,
                uniqueUrlCount: 4,
                indexedAt: null,
              },
              {
                version: "1.2.0",
                versionId: 23,
                status: "queued",
                progressPages: 0,
                progressMaxPages: 10,
                sourceUrl: null,
                documentCount: 0,
                uniqueUrlCount: 0,
                indexedAt: null,
              },
            ],
          ],
        ]);
        mockStore.queryLibraryVersions.mockResolvedValue(enrichedMap);
        const result = await docService.listLibraries();
        const lib = result.find((r) => r.library === "libActive");
        expect(lib).toBeTruthy();
        const byVer = Object.fromEntries(lib!.versions.map((v) => [v.ref.version, v]));
        expect(byVer["1.0.0"].progress).toBeUndefined();
        expect(byVer["1.1.0"].progress).toEqual({ pages: 2, maxPages: 10 });
        expect(byVer["1.2.0"].progress).toEqual({ pages: 0, maxPages: 10 });
      });
    });

    describe("cleanup", () => {
      it("should shutdown without errors", async () => {
        const service = new DocumentManagementService("/test/path", {
          provider: "openai",
          model: "text-embedding-ada-002",
          dimensions: 1536,
          modelSpec: "openai:text-embedding-ada-002",
        });

        // Should complete shutdown without errors
        await expect(service.shutdown()).resolves.not.toThrow();
        expect(mockStore.shutdown).toHaveBeenCalledOnce();
      });
    });
  }); // Closing brace for describe("Core Functionality", ...)
}); // Closing brace for the main describe block
