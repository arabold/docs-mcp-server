import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { VersionStatus, VersionSummary } from "../store/types";

// Define the structure for the tool's output, using the detailed version info
export interface LibraryInfo {
  name: string;
  versions: Array<{
    version: string;
    documentCount: number;
    uniqueUrlCount: number;
    indexedAt: string | null;
    status: VersionStatus;
    // Progress is omitted for COMPLETED versions to reduce noise
    progress?: { pages: number; maxPages: number };
    sourceUrl?: string | null;
  }>;
}

export interface ListLibrariesResult {
  libraries: LibraryInfo[];
}

/**
 * Tool for listing all available libraries and their indexed versions in the store.
 */
export class ListLibrariesTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(_options?: Record<string, never>): Promise<ListLibrariesResult> {
    // docService.listLibraries() now returns the detailed structure directly
    const rawLibraries = await this.docService.listLibraries();

    // The structure returned by listLibraries already matches LibraryInfo[]
    // No complex mapping is needed here anymore, just ensure the names match
    const libraries: LibraryInfo[] = rawLibraries.map(({ library, versions }) => ({
      name: library,
      versions: versions.map((v: VersionSummary) => ({
        version: v.ref.version,
        documentCount: v.counts.documents,
        uniqueUrlCount: v.counts.uniqueUrls,
        indexedAt: v.indexedAt,
        status: v.status,
        ...(v.progress ? { progress: v.progress } : undefined),
        sourceUrl: v.sourceUrl,
      })),
    }));

    return { libraries };
  }
}
