import crypto from "node:crypto";
import type { Document } from "@langchain/core/documents";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { analytics } from "../telemetry";
import { logger } from "../utils/logger";

export interface PlaintextToolOptions {
  library: string;
  version?: string | null;
  content: string;
  title: string;
  url?: string; // Optional synthetic URL for identification
  metadata?: {
    description?: string;
    tags?: string[];
    contentType?: string;
  };
}

export interface PlaintextToolResult {
  /** Number of documents processed (should be 1 for plaintext) */
  documentsAdded: number;
  /** The synthetic URL generated for the document */
  url: string;
}

/**
 * Tool for adding plaintext content directly to the document store.
 * Bypasses the scraping pipeline and uses DocumentManagementService.addDocument() directly.
 */
export class PlaintextTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: PlaintextToolOptions): Promise<PlaintextToolResult> {
    const { library, version, content, title, url, metadata } = options;

    return analytics.trackTool(
      "add_plaintext",
      async () => {
        // Validate required fields
        if (!content || !content.trim()) {
          throw new Error("Content cannot be empty");
        }
        if (!title || !title.trim()) {
          throw new Error("Title cannot be empty");
        }
        if (!library || !library.trim()) {
          throw new Error("Library cannot be empty");
        }

        // Generate synthetic URL if not provided
        const documentUrl = url || this.generatePlaintextUrl(library, version, content);

        logger.info(
          `📝 Adding plaintext document: ${title} (${library}@${version || "latest"})`,
        );

        // Create Document object from plaintext input
        const document: Document = {
          pageContent: content,
          metadata: {
            url: documentUrl,
            title: title,
            library: library,
            version: version || null,
            description: metadata?.description,
            tags: metadata?.tags,
            mimeType: metadata?.contentType || "text/plain",
            sourceType: "plaintext", // Custom field to distinguish from scraped content
            // Add any additional metadata
            ...(metadata && Object.keys(metadata).length > 0
              ? { customMetadata: metadata }
              : {}),
          },
        };

        // Use DocumentManagementService to process and store the document
        await this.docService.addDocument(library, version, document);

        logger.info(`✅ Successfully added plaintext document: ${title}`);

        return {
          documentsAdded: 1,
          url: documentUrl,
        };
      },
      (result) => ({
        library,
        version,
        title,
        contentLength: content.length,
        hasCustomUrl: !!url,
        hasDescription: !!metadata?.description,
        hasCustomMetadata: !!(metadata && Object.keys(metadata).length > 0),
        documentUrl: result.url,
      }),
    );
  }

  /**
   * Generates a synthetic URL for plaintext content using library, version, and content hash.
   * Format: plaintext://library/version/hash or plaintext://library/hash (if no version)
   */
  private generatePlaintextUrl(
    library: string,
    version: string | null | undefined,
    content: string,
  ): string {
    // Generate a hash of the content for uniqueness
    const hash = crypto
      .createHash("sha256")
      .update(content)
      .digest("hex")
      .substring(0, 8);

    // Construct URL with optional version
    const versionPart = version ? `/${version}` : "";
    return `plaintext://${library}${versionPart}/${hash}`;
  }
}
