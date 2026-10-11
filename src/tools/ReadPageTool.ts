import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { PageContentResult } from "../store/types";
import { ValidationError } from "./errors";

export interface ReadPageToolOptions {
  library: string;
  pathOrUrl: string;
  version?: string;
  startChunk?: number;
  maxChars?: number;
}

export type ReadPageToolResult = PageContentResult;

/**
 * Strips what agents tend to copy along with a link: the HTML-escaped `&lt;…&gt;`
 * wrapper, angle brackets and quotes, `./` and `../` prefixes, and Windows
 * backslashes. Percent-encoding is left as given.
 */
function cleanPageInput(input: string): string {
  let value = input.trim();
  if (/^&lt;.*&gt;$/i.test(value)) {
    value = value.slice(4, -4).replace(/&amp;/gi, "&");
  }
  return value
    .replace(/\\/g, "/")
    .replace(/^[<"']+|[>"']+$/g, "")
    .trim()
    .replace(/^(\.\.?\/)+/, "");
}

/**
 * Tool for reading a stored documentation page without scraping it again.
 * Long pages are read in windows of whole chunks, continued with `startChunk`.
 */
export class ReadPageTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: ReadPageToolOptions): Promise<ReadPageToolResult> {
    const { library, pathOrUrl, version, startChunk, maxChars } = options;

    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    const target = typeof pathOrUrl === "string" ? cleanPageInput(pathOrUrl) : "";
    if (!target) {
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

    if (startChunk !== undefined && (!Number.isInteger(startChunk) || startChunk < 0)) {
      throw new ValidationError(
        "startChunk must be a non-negative integer if provided.",
        this.constructor.name,
      );
    }

    return this.docService.getPageContent(library.trim(), version?.trim(), target, {
      startChunk,
      maxChars,
    });
  }
}
