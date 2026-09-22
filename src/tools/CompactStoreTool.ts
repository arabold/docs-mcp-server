import type { IDocumentManagement } from "../store/trpc/interfaces";
import type { CompactResult } from "../store/types";

export interface CompactStoreToolOptions {
  force?: boolean;
  vacuum?: boolean;
}

export type CompactStoreToolResult = CompactResult;

/**
 * Tool for reclaiming unused SQLite pages and truncating the WAL file.
 */
export class CompactStoreTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: CompactStoreToolOptions = {}): Promise<CompactStoreToolResult> {
    return await this.docService.compact({
      force: options.force,
      vacuum: options.vacuum,
    });
  }
}
