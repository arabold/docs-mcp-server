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
    let nextId = 1;
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
      id: nextId++,
      ref: { library: lib, version },
      status,
      ...(status === "completed" ? null : { progress: { pages, maxPages } }),
      counts: { documents: docs, uniqueUrls: urls },
      indexedAt,
      sourceUrl: null,
      preserveHashes: version === "18.2.0",
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
      {
        // Still scraping: the only kind of version that reports progress
        library: "in-progress",
        versions: [mk("in-progress", "2.0.0", 3, 3, null, "running", 3, 40)],
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
              id: expect.any(Number),
              version: "18.2.0",
              documentCount: 150,
              uniqueUrlCount: 50,
              indexedAt: "2024-01-10T10:00:00.000Z",
              status: "completed",
              sourceUrl: null,
              preserveHashes: true,
            },
            {
              id: expect.any(Number),
              version: "17.0.1",
              documentCount: 120,
              uniqueUrlCount: 45,
              indexedAt: "2023-05-15T12:30:00.000Z",
              status: "completed",
              sourceUrl: null,
              preserveHashes: false,
            },
          ],
        },
        {
          name: "vue",
          versions: [
            {
              id: expect.any(Number),
              version: "3.2.0",
              documentCount: 200,
              uniqueUrlCount: 70,
              indexedAt: "2024-02-20T08:00:00.000Z",
              status: "completed",
              sourceUrl: null,
              preserveHashes: false,
            },
          ],
        },
        {
          name: "old-lib",
          versions: [
            {
              id: expect.any(Number),
              version: "1.0.0",
              documentCount: 10,
              uniqueUrlCount: 5,
              indexedAt: null,
              status: "completed",
              sourceUrl: null,
              preserveHashes: false,
            },
          ],
        },
        {
          name: "unversioned-only",
          versions: [
            {
              id: expect.any(Number),
              version: "",
              documentCount: 1,
              uniqueUrlCount: 1,
              indexedAt: "2024-04-01T00:00:00.000Z",
              status: "completed",
              sourceUrl: null,
              preserveHashes: false,
            },
          ],
        },
        {
          name: "mixed-versions",
          versions: [
            {
              id: expect.any(Number),
              version: "",
              documentCount: 2,
              uniqueUrlCount: 1,
              indexedAt: "2024-04-03T00:00:00.000Z",
              status: "completed",
              sourceUrl: null,
              preserveHashes: false,
            },
            {
              id: expect.any(Number),
              version: "1.0.0",
              documentCount: 5,
              uniqueUrlCount: 2,
              indexedAt: "2024-04-02T00:00:00.000Z",
              status: "completed",
              sourceUrl: null,
              preserveHashes: false,
            },
          ],
        },
        {
          name: "in-progress",
          versions: [
            {
              id: expect.any(Number),
              version: "2.0.0",
              documentCount: 3,
              uniqueUrlCount: 3,
              indexedAt: null,
              status: "running",
              progress: { pages: 3, maxPages: 40 },
              sourceUrl: null,
              preserveHashes: false,
            },
          ],
        },
      ],
    });
  });
});
