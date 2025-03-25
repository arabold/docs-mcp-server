import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Document } from "@langchain/core/documents";
import semver from "semver";
import { GreedySplitter, SemanticMarkdownSplitter } from "../splitter";
import type { ContentChunk, DocumentSplitter } from "../splitter/types";
import { VersionNotFoundError } from "../tools";
import { logger } from "../utils/logger";
import { DocumentRetrieverService } from "./DocumentRetrieverService";
import { DocumentStore } from "./DocumentStore";
import { StoreError } from "./errors";
import type { LibraryVersion, StoreSearchResult } from "./types";

/**
 * Provides semantic search capabilities across different versions of library documentation.
 */
export class DocumentManagementService {
  private readonly store: DocumentStore;
  private readonly documentRetriever: DocumentRetrieverService;
  private readonly splitter: DocumentSplitter;

  constructor() {
    const dbPath = path.join(process.cwd(), ".store", "documents.db");
    mkdirSync(path.dirname(dbPath), { recursive: true });

    this.store = new DocumentStore(dbPath);
    this.documentRetriever = new DocumentRetrieverService(this.store);

    const minChunkSize = 500;
    const maxChunkSize = 1500;
    const semanticSplitter = new SemanticMarkdownSplitter(maxChunkSize);
    const greedySplitter = new GreedySplitter(
      semanticSplitter,
      minChunkSize,
      maxChunkSize,
    );

    this.splitter = greedySplitter;
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async shutdown(): Promise<void> {
    logger.info("🔌 Shutting down store manager");
    await this.store.shutdown();
  }

  /**
   * Returns a list of all available versions for a library.
   * Only returns versions that follow semver format.
   */
  async listVersions(library: string): Promise<LibraryVersion[]> {
    const versions = await this.store.queryUniqueVersions(library);
    return versions
      .filter((v) => semver.valid(v))
      .map((version) => ({
        version,
        indexed: true,
      }));
  }

  async exists(library: string, version: string): Promise<boolean> {
    return this.store.checkDocumentExists(library, version);
  }

  /**
   * Finds the most appropriate version of documentation based on the requested version.
   * When no target version is specified, returns the latest version.
   *
   * Version matching behavior:
   * - Exact versions (e.g., "18.0.0"): Matches that version or any earlier version
   * - X-Range patterns (e.g., "5.x", "5.2.x"): Matches within the specified range
   * - "latest" or no version: Returns the latest available version
   *
   * For documentation, we prefer matching older versions over no match at all,
   * since older docs are often still relevant and useful.
   */
  async findBestVersion(library: string, targetVersion?: string): Promise<string> {
    logger.info(
      `🔍 Finding best version for ${library}${targetVersion ? `@${targetVersion}` : ""}`,
    );

    const validVersions = (await this.listVersions(library)).filter((v) => v.indexed);

    if (validVersions.length === 0) {
      logger.warn(`⚠️ No valid versions found for ${library}`);
      throw new VersionNotFoundError(library, targetVersion ?? "", validVersions);
    }

    const versionStrings = validVersions.map((v) => v.version);

    if (!targetVersion || targetVersion === "latest") {
      const result = semver.maxSatisfying(versionStrings, "*");
      if (!result) {
        throw new VersionNotFoundError(library, targetVersion ?? "", validVersions);
      }
      return result;
    }

    const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
    if (!versionRegex.test(targetVersion)) {
      logger.warn(`⚠️ Invalid version format: ${targetVersion}`);
      throw new VersionNotFoundError(library, targetVersion, validVersions);
    }

    let range = targetVersion;

    if (!semver.validRange(targetVersion)) {
      range = `~${targetVersion}`;
    } else if (semver.valid(targetVersion)) {
      range = `${range} || <=${targetVersion}`;
    }

    const result = semver.maxSatisfying(versionStrings, range);
    if (result) {
      logger.info(`✅ Found version ${result} for ${library}@${targetVersion}`);
    } else {
      logger.warn(`⚠️ No matching version found for ${library}@${targetVersion}`);
    }

    if (!result) {
      throw new VersionNotFoundError(library, targetVersion, validVersions);
    }
    return result;
  }

  async deleteStore(library: string, version: string): Promise<void> {
    logger.info(`🗑️ Deleting store for ${library}@${version}`);
    const count = await this.store.deleteDocuments(library, version);
    logger.info(`📊 Deleted ${count} documents`);
  }

  async removeAllDocuments(library: string, version: string): Promise<void> {
    logger.info(`🗑️ Removing all documents from ${library}@${version} store`);
    const count = await this.store.deleteDocuments(library, version);
    logger.info(`📊 Deleted ${count} documents`);
  }

  /**
   * Adds a document to the store, splitting it into smaller chunks for better search results.
   * Uses SemanticMarkdownSplitter to maintain markdown structure and content types during splitting.
   * Preserves hierarchical structure of documents and distinguishes between text and code segments.
   */
  async addDocument(library: string, version: string, document: Document): Promise<void> {
    const url = document.metadata.url as string;
    if (!url || typeof url !== "string" || !url.trim()) {
      throw new StoreError("Document metadata must include a valid URL");
    }

    logger.info(`📚 Adding document: ${document.metadata.title}`);

    if (!document.pageContent.trim()) {
      throw new Error("Document content cannot be empty");
    }

    // Split document into semantic chunks
    const chunks = await this.splitter.splitText(document.pageContent);

    // Convert semantic chunks to documents
    const splitDocs = chunks.map((chunk: ContentChunk) => ({
      pageContent: chunk.content,
      metadata: {
        ...document.metadata,
        level: chunk.section.level,
        path: chunk.section.path,
      },
    }));
    logger.info(`📄 Split document into ${splitDocs.length} chunks`);

    // Add split documents to store
    await this.store.addDocuments(library, version, splitDocs);
  }

  /**
   * Searches for documentation content across versions.
   * Uses PostgreSQL's built-in text search and vector similarity.
   */
  async searchStore(
    library: string,
    version: string,
    query: string,
    limit = 5,
  ): Promise<StoreSearchResult[]> {
    return this.documentRetriever.search(library, version, query, limit);
  }

  async listLibraries(): Promise<
    Array<{
      library: string;
      versions: Array<{ version: string; indexed: boolean }>;
    }>
  > {
    const libraryMap = await this.store.queryLibraryVersions();
    return Array.from(libraryMap.entries()).map(([library, versions]) => ({
      library,
      versions: Array.from(versions).map((version) => ({
        version,
        indexed: true,
      })),
    }));
  }
}
