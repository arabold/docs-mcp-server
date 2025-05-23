import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentManagementService } from "../store/DocumentManagementService";
import type { LibraryVersionDetails } from "../store/types"; // Import the new type
import { logger } from "../utils/logger"; // Assuming logger might be used internally, mock it just in case
import { ListLibrariesTool } from "./ListLibrariesTool";

// Mock dependencies
vi.mock("../store/DocumentManagementService");
vi.mock("../utils/logger");

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
    const mockRawLibraries = [
      {
        library: "react", // Standard case
        versions: [
          {
            version: "18.2.0",
            documentCount: 150,
            uniqueUrlCount: 50,
            indexedAt: "2024-01-10T10:00:00.000Z",
          },
          {
            version: "17.0.1",
            documentCount: 120,
            uniqueUrlCount: 45,
            indexedAt: "2023-05-15T12:30:00.000Z",
          },
        ],
      },
      {
        library: "vue", // Standard case
        versions: [
          {
            version: "3.2.0",
            documentCount: 200,
            uniqueUrlCount: 70,
            indexedAt: "2024-02-20T08:00:00.000Z",
          },
        ],
      },
      {
        library: "old-lib", // Example with null indexedAt and semver
        versions: [
          {
            version: "1.0.0",
            documentCount: 10,
            uniqueUrlCount: 5,
            indexedAt: null,
          },
        ],
      },
      {
        library: "unversioned-only", // Only unversioned
        versions: [
          {
            version: "",
            documentCount: 1,
            uniqueUrlCount: 1,
            indexedAt: "2024-04-01T00:00:00.000Z",
          },
        ],
      },
      {
        library: "mixed-versions", // Semver and unversioned
        versions: [
          {
            version: "", // Unversioned
            documentCount: 2,
            uniqueUrlCount: 1,
            indexedAt: "2024-04-03T00:00:00.000Z",
          },
          {
            version: "1.0.0", // Semver
            documentCount: 5,
            uniqueUrlCount: 2,
            indexedAt: "2024-04-02T00:00:00.000Z",
          },
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
            },
            {
              version: "17.0.1",
              documentCount: 120,
              uniqueUrlCount: 45,
              indexedAt: "2023-05-15T12:30:00.000Z",
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
            },
            {
              version: "1.0.0",
              documentCount: 5,
              uniqueUrlCount: 2,
              indexedAt: "2024-04-02T00:00:00.000Z",
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
