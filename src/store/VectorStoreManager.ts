import type { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import semver from "semver";
import { BM25Retriever } from "@langchain/community/retrievers/bm25";
import type { SearchResult, VersionInfo } from "../types";
import { logger } from "../utils/logger";
import { DocumentStore } from "./DocumentStore";

export class VectorStoreManager {
  private readonly store: DocumentStore;

  constructor() {
    const connectionString = process.env.POSTGRES_CONNECTION || "";
    if (!connectionString) {
      throw new Error("POSTGRES_CONNECTION environment variable is required");
    }
    this.store = new DocumentStore(connectionString);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  async shutdown(): Promise<void> {
    logger.info("🔌 Shutting down store manager");
    await this.store.shutdown();
  }

  async listVersions(library: string): Promise<VersionInfo[]> {
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

  async findBestVersion(
    library: string,
    targetVersion?: string
  ): Promise<string | null> {
    logger.info(
      `🔍 Finding best version for ${library}${targetVersion ? `@${targetVersion}` : ""}`
    );

    const validVersions = (await this.listVersions(library)).filter(
      (v) => v.indexed
    );

    if (validVersions.length === 0) {
      logger.warn(`⚠️ No valid versions found for ${library}`);
      return null;
    }

    if (targetVersion) {
      const versionRegex = /^(\d+)(?:\.(?:x(?:\.x)?|\d+(?:\.(?:x|\d+))?))?$|^$/;
      if (!versionRegex.test(targetVersion)) {
        logger.warn(`⚠️ Invalid version format: ${targetVersion}`);
        return null;
      }
    }

    const versionStrings = validVersions.map((v) => v.version);

    if (!targetVersion) {
      return semver.maxSatisfying(versionStrings, "*");
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
      logger.warn(
        `⚠️ No matching version found for ${library}@${targetVersion}`
      );
    }

    return result || null;
  }

  async deleteStore(library: string, version: string): Promise<void> {
    logger.info(`🗑️ Deleting store for ${library}@${version}`);
    await this.store.deleteDocuments({ library, version });
  }

  async removeAllDocuments(library: string, version: string): Promise<void> {
    logger.info(`🗑️ Removing all documents from ${library}@${version} store`);
    await this.store.deleteDocuments({ library, version });
  }

  async addDocument(
    library: string,
    version: string,
    document: Document
  ): Promise<void> {
    logger.info(`📚 Adding document: ${document.metadata.title}`);

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 4000,
      chunkOverlap: 200,
      separators: ["\n\n", "\n", " ", ""], // Respect markdown structure
    });

    if (!document.pageContent.trim()) {
      throw new Error("Document content cannot be empty");
    }

    // Split document into smaller chunks
    const splitDocs = await splitter.splitDocuments([document]);
    logger.info(`📄 Split document into ${splitDocs.length} chunks`);

    // Add split documents to store
    await this.store.addDocuments(splitDocs, { library, version });
  }

  async searchStore(
    library: string,
    version: string,
    query: string,
    limit = 5
  ): Promise<SearchResult[]> {
    const results = await this.store.search(query, limit, { library, version });

    // Rerank with BM25
    const rerankedResults = await BM25Retriever.fromDocuments(results, {
      k: limit,
      includeScore: true,
    }).invoke(query);

    return rerankedResults.map((doc) => ({
      content: doc.pageContent,
      score: (doc.metadata.bm25Score as number) ?? 0,
      metadata: {
        url: doc.metadata.url as string,
        title: doc.metadata.title as string,
        library: doc.metadata.library as string,
        version: doc.metadata.version as string,
      },
    }));
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
