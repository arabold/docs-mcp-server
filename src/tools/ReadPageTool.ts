import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { PageContentResult } from "../store/types";
import { ValidationError } from "./errors";

export interface ReadPageToolOptions {
  library: string;
  pathOrUrl: string;
  version?: string;
  maxChars?: number;
}

export type ReadPageToolResult = PageContentResult;

/**
 * Tool for retrieving the full Markdown documentation of a specific page
 * directly from the local store without re-scraping the web.
 */
export class ReadPageTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: ReadPageToolOptions): Promise<ReadPageToolResult> {
    const { library, pathOrUrl, version, maxChars } = options;

    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (!pathOrUrl || typeof pathOrUrl !== "string" || pathOrUrl.trim() === "") {
      throw new ValidationError(
        "Path or URL is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    if (maxChars !== undefined && (!Number.isFinite(maxChars) || maxChars <= 0)) {
      throw new ValidationError(
        "maxChars must be a positive number if provided.",
        this.constructor.name,
      );
    }

    return this.docService.getPageContent(
      library.trim(),
      version?.trim(),
      pathOrUrl.trim(),
      { maxChars },
    );
  }
}
