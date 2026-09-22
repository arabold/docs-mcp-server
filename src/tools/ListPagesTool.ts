import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { ListPagesResult } from "../store/types";
import { ValidationError } from "./errors";

export interface ListPagesToolOptions {
  library: string;
  version?: string;
  prefix?: string;
  limit?: number;
  offset?: number;
}

export type ListPagesToolResult = ListPagesResult;

/**
 * Tool for listing indexed pages and documentation sitemap for a library version.
 */
export class ListPagesTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: ListPagesToolOptions): Promise<ListPagesToolResult> {
    const { library, version, prefix, offset = 0 } = options;

    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    let limit = options.limit ?? 50;
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = 50;
    } else if (limit > 200) {
      limit = 200;
    }

    const safeOffset =
      offset !== undefined && Number.isFinite(offset) && offset >= 0
        ? Math.floor(offset)
        : 0;

    return this.docService.listPages(library.trim(), version?.trim(), {
      prefix: prefix?.trim(),
      limit,
      offset: safeOffset,
    });
  }
}
