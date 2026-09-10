import { VersionNotFoundInStoreError } from "../store";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { StoreSearchResult } from "../store/types";
import { logger } from "../utils/logger";
import { ValidationError } from "./errors";

export interface SearchToolOptions {
  library: string;
  version?: string;
  query: string;
  limit?: number;
  exactMatch?: boolean;
  /** "cards" returns a compact digest per result unit instead of full content. */
  detail?: "cards" | "full";
}

export interface SearchToolResultError {
  message: string;
  availableVersions?: Array<{
    version: string;
    documentCount: number;
    uniqueUrlCount: number;
    indexedAt: string | null;
  }>;
  suggestions?: string[]; // Specific to LibraryNotFoundInStoreError
}

export interface SearchToolResult {
  results: StoreSearchResult[];
  cards?: CardSearchResult[];
}

export interface CardSearchResult {
  url: string;
  /** Repo-relative unit path, e.g. `cases/04-text-input-controls.md`. */
  unitPath: string;
  layer: string | null;
  topic: string | null;
  /** Digest block for pyramid units; trimmed excerpt for generic pages. */
  card: string;
  score: number | null;
}

// Digest block is anchored by its heading: HTML comments do not survive the
// markdown splitter, so we slice "## API 摘要" up to the next H2.
const DIGEST_RE = /## API 摘要\s*\n([\s\S]*?)(?=\n## |\n$)/;
const H1_TITLE_RE = /^# (.+?)\s*(?:\(L[123][^)]*\))?\s*$/m;

/** Derives a short, stable unit path from a page URL. */
function unitPathFromUrl(url: string, library: string): string {
  const marker = `/${library}/`;
  const at = url.indexOf(marker);
  if (at >= 0) {
    return url.slice(at + marker.length);
  }
  const parts = url.split("/").filter(Boolean);
  return parts.slice(-2).join("/");
}

function trimExcerpt(text: string, maxChars: number): string {
  const clean = text.replace(/<!--digest:(start|end)-->/g, "").trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const cut = clean.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf("\n\n"), cut.lastIndexOf("\n"));
  return `${cut.slice(0, stop > maxChars * 0.5 ? stop : maxChars)}\n…`;
}

/**
 * Tool for searching indexed documentation.
 * Supports exact version matches and version range patterns.
 * Returns available versions when requested version is not found.
 */
export class SearchTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: SearchToolOptions): Promise<SearchToolResult> {
    const { library, version, query, limit = 5, exactMatch = false } = options;

    // Validate required inputs
    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (!query || typeof query !== "string" || query.trim() === "") {
      throw new ValidationError(
        "Query is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (limit !== undefined && (typeof limit !== "number" || limit < 1 || limit > 100)) {
      throw new ValidationError(
        "Limit must be a number between 1 and 100.",
        this.constructor.name,
      );
    }

    // When exactMatch is true, version must be specified and not 'latest'
    if (exactMatch && (!version || version === "latest")) {
      // Get available *detailed* versions for error message
      await this.docService.validateLibraryExists(library);
      // Fetch detailed versions using listLibraries and find the specific library
      const allLibraries = await this.docService.listLibraries();
      const libraryInfo = allLibraries.find((lib) => lib.library === library);
      const availableVersions = libraryInfo
        ? libraryInfo.versions.map((v) => v.ref.version)
        : [];
      throw new VersionNotFoundInStoreError(
        library,
        version ?? "latest",
        availableVersions,
      );
    }

    // Default to 'latest' only when exactMatch is false
    const resolvedVersion = version || "latest";

    logger.info(
      `🔍 Searching ${library}@${resolvedVersion} for: ${query}${exactMatch ? " (exact match)" : ""}`,
    );

    try {
      // 1. Validate library exists first
      await this.docService.validateLibraryExists(library);

      // 2. Proceed with version finding and searching
      let versionToSearch: string | null | undefined = resolvedVersion;

      if (!exactMatch) {
        // If not exact match, find the best version (which might be null)
        const versionResult = await this.docService.findBestVersion(library, version);
        // Use the bestMatch from the result, which could be null
        versionToSearch = versionResult.bestMatch;

        // If findBestVersion returned null (no matching semver) AND unversioned docs exist,
        // should we search unversioned? The current logic passes null to searchStore,
        // which gets normalized to "" (unversioned). This seems reasonable.
        // If findBestVersion threw VersionNotFoundInStoreError, it's caught below.
      }
      // If exactMatch is true, versionToSearch remains the originally provided version.

      // Note: versionToSearch can be string | null | undefined here.
      // searchStore handles null/undefined by normalizing to "".
      // Card mode dedupes to one card per unit, so overfetch raw chunks to
      // keep `limit` unique units visible instead of wasting slots on
      // duplicate chunks of the same page.
      const fetchLimit =
        options.detail === "cards" ? Math.min((limit ?? 5) * 2, 50) : limit;
      const results = await this.docService.searchStore(
        library,
        versionToSearch,
        query,
        fetchLimit,
      );
      logger.info(`✅ Found ${results.length} matching results`);

      if (options.detail === "cards") {
        const cards = (await this.buildCards(library, versionToSearch, results)).slice(
          0,
          limit ?? 5,
        );
        return { results: results.slice(0, limit ?? 5), cards };
      }

      return { results };
    } catch (error) {
      logger.error(
        `❌ Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      throw error;
    }
  }

  /**
   * Builds one digest card per result unit (pyramid-aware progressive
   * disclosure). Pyramid units carry a generated digest block between
   * digest markers; generic pages fall back to a trimmed excerpt.
   */
  private async buildCards(
    library: string,
    version: string | null | undefined,
    results: StoreSearchResult[],
  ): Promise<CardSearchResult[]> {
    const cards: CardSearchResult[] = [];
    const seen = new Set<string>();
    for (const r of results) {
      const unitPath = unitPathFromUrl(r.url, library);
      // One card per unit: search may return several chunks of the same page.
      if (seen.has(unitPath)) {
        continue;
      }
      seen.add(unitPath);
      const layer = unitPath.startsWith("cases/")
        ? "L2"
        : unitPath.startsWith("api/")
          ? "L3"
          : unitPath.endsWith("index.md")
            ? "L1"
            : null;
      let card: string | null = null;
      let topic: string | null = null;
      try {
        const page = await this.docService.getDocumentsByUrl(library, version, unitPath);
        if (page) {
          const full = page.chunks.map((c) => c.content).join("\n\n");
          const digest = full.match(DIGEST_RE);
          if (digest) {
            card = digest[1].trim();
          }
          topic = full.match(H1_TITLE_RE)?.[1]?.trim() ?? null;
          if (!card) {
            card = trimExcerpt(full, 700);
          }
        }
      } catch (error) {
        logger.warn(
          `card build failed for ${unitPath}: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
      cards.push({
        url: r.url,
        unitPath,
        layer,
        topic,
        card: card ?? trimExcerpt(r.content, 700),
        score: r.score,
      });
    }
    return cards;
  }
}
