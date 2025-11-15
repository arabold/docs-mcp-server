import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import { ListLibrariesTool } from "./ListLibrariesTool";

// Mock dependencies
vi.mock("../store/DocumentManagementService");

describe("ListLibrariesTool", () => {
  let mockDocService: Partial<DocumentManagementService>;
  let listLibrariesTool: ListLibrariesTool;

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();

    // Setup mock DocumentManagementService
    mockDocService = {
      listLibraries: vi.fn(),
    };

    // Create instance of the tool with the mock service
    listLibrariesTool = new ListLibrariesTool(
      mockDocService as DocumentManagementService,
    );
  });

  it("should return a list of libraries with their detailed versions, including unversioned", async () => {
    // Mock data now uses LibraryVersionDetails structure and includes unversioned cases
    const mk = (
      lib: string,
      version: string,
      docs: number,
      urls: number,
      indexedAt: string | null,
      status: string = "completed",
      pages = docs,
      maxPages = docs,
    ) => ({
      id: Math.floor(Math.random() * 1000) + 1,
      ref: { library: lib, version },
      status,
      ...(status === "completed" ? null : { progress: { pages, maxPages } }),
      counts: { documents: docs, uniqueUrls: urls },
      indexedAt,
      sourceUrl: null,
    });
    const mockRawLibraries = [
      {
        library: "react",
        versions: [
          mk("react", "18.2.0", 150, 50, "2024-01-10T10:00:00.000Z"),
          mk("react", "17.0.1", 120, 45, "2023-05-15T12:30:00.000Z"),
        ],
      },
      {
        library: "vue",
        versions: [mk("vue", "3.2.0", 200, 70, "2024-02-20T08:00:00.000Z")],
      },
      { library: "old-lib", versions: [mk("old-lib", "1.0.0", 10, 5, null)] },
      {
        library: "unversioned-only",
        versions: [mk("unversioned-only", "", 1, 1, "2024-04-01T00:00:00.000Z")],
      },
      {
        library: "mixed-versions",
        versions: [
          mk("mixed-versions", "", 2, 1, "2024-04-03T00:00:00.000Z"),
          mk("mixed-versions", "1.0.0", 5, 2, "2024-04-02T00:00:00.000Z"),
        ],
      },
    ];
    (mockDocService.listLibraries as Mock).mockResolvedValue(mockRawLibraries);

    const result = await listLibrariesTool.execute();

    expect(mockDocService.listLibraries).toHaveBeenCalledOnce();
    // Assert the result matches the detailed structure, including unversioned libs
    expect(result).toEqual({
      libraries: [
        {
          name: "react",
          versions: [
            {
              version: "18.2.0",
              documentCount: 150,
              uniqueUrlCount: 50,
              indexedAt: "2024-01-10T10:00:00.000Z",
              status: "completed",
              sourceUrl: null,
            },
            {
              version: "17.0.1",
              documentCount: 120,
              uniqueUrlCount: 45,
              indexedAt: "2023-05-15T12:30:00.000Z",
              status: "completed",
              sourceUrl: null,
            },
          ],
        },
        {
          name: "vue",
          versions: [
            {
              version: "3.2.0",
              documentCount: 200,
              uniqueUrlCount: 70,
              indexedAt: "2024-02-20T08:00:00.000Z",
              status: "completed",
              sourceUrl: null,
            },
          ],
        },
        {
          name: "old-lib",
          versions: [
            {
              version: "1.0.0",
              documentCount: 10,
              uniqueUrlCount: 5,
              indexedAt: null,
              status: "completed",
              sourceUrl: null,
            },
          ],
        },
        {
          name: "unversioned-only",
          versions: [
            {
              version: "",
              documentCount: 1,
              uniqueUrlCount: 1,
              indexedAt: "2024-04-01T00:00:00.000Z",
              status: "completed",
              sourceUrl: null,
            },
          ],
        },
        {
          name: "mixed-versions",
          versions: [
            {
              version: "",
              documentCount: 2,
              uniqueUrlCount: 1,
              indexedAt: "2024-04-03T00:00:00.000Z",
              status: "completed",
              sourceUrl: null,
            },
            {
              version: "1.0.0",
              documentCount: 5,
              uniqueUrlCount: 2,
              indexedAt: "2024-04-02T00:00:00.000Z",
              status: "completed",
              sourceUrl: null,
            },
          ],
        },
      ],
    });
    // Check structure more generally for the new fields
    expect(result.libraries).toBeInstanceOf(Array);
    expect(result.libraries.length).toBe(5); // Updated length check for new mock data
    for (const lib of result.libraries) {
      expect(lib).toHaveProperty("name");
      expect(lib).toHaveProperty("versions");
      expect(lib.versions).toBeInstanceOf(Array);
      for (const v of lib.versions) {
        expect(v).toHaveProperty("version");
        expect(v).toHaveProperty("documentCount");
        expect(v).toHaveProperty("uniqueUrlCount");
        expect(v).toHaveProperty("indexedAt"); // Can be string or null
        expect(v).toHaveProperty("status");
        if (v.status !== "completed") {
          expect(v).toHaveProperty("progress");
        }
      }
    }
  });

  it("should return an empty list when no libraries are in the store", async () => {
    // Mock service returns an empty array
    (mockDocService.listLibraries as Mock).mockResolvedValue([]);

    const result = await listLibrariesTool.execute();

    expect(mockDocService.listLibraries).toHaveBeenCalledOnce();
    expect(result).toEqual({ libraries: [] });
  });

  it("should handle potential errors from the docService", async () => {
    const error = new Error("Failed to access store");
    (mockDocService.listLibraries as Mock).mockRejectedValue(error);

    await expect(listLibrariesTool.execute()).rejects.toThrow("Failed to access store");
  });
});
