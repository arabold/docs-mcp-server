import { VersionNotFoundInStoreError } from "../store";
import type { IDocumentManagement } from "../store/trpc/interfaces";
import { logger } from "../utils/logger";
import { ValidationError } from "./errors";

export interface ReadSectionToolOptions {
  library: string;
  version?: string;
  /** Repo-relative unit path, e.g. `cases/04-text-input-controls.md`. */
  path: string;
  /** Optional section anchor, e.g. `button-interaction`. Omit for the whole unit. */
  section?: string;
}

export interface ReadSectionToolResult {
  url: string;
  title: string | null;
  content: string;
  sections: string[];
}

const SECTION_HEADING_RE = /^(#{1,6})\s+(.+?)\s*\{#([a-z0-9-]+)\}\s*$/gm;

/**
 * Pyramid-aware progressive disclosure: fetches one retrieval unit (or a
 * single anchored section of it) in full. Complements the card-mode
 * search_docs tool.
 */
export class ReadSectionTool {
  private docService: IDocumentManagement;

  constructor(docService: IDocumentManagement) {
    this.docService = docService;
  }

  async execute(options: ReadSectionToolOptions): Promise<ReadSectionToolResult> {
    const { library, version, path, section } = options;

    if (!library || typeof library !== "string" || library.trim() === "") {
      throw new ValidationError(
        "Library name is required and must be a non-empty string.",
        this.constructor.name,
      );
    }
    if (!path || typeof path !== "string" || path.trim() === "") {
      throw new ValidationError(
        "Path is required and must be a non-empty string.",
        this.constructor.name,
      );
    }

    await this.docService.validateLibraryExists(library);
    const versionResult = await this.docService.findBestVersion(library, version);
    const versionToRead = versionResult.bestMatch;

    const page = await this.docService.getDocumentsByUrl(library, versionToRead, path);
    if (!page) {
      throw new VersionNotFoundInStoreError(library, version || "latest", []);
    }

    const full = page.chunks.map((c) => c.content).join("\n\n");
    const headings = [...full.matchAll(SECTION_HEADING_RE)].map((m) => ({
      level: m[1].length,
      title: m[2],
      anchor: m[3],
      index: m.index ?? 0,
    }));
    const sections = headings.map((h) => h.anchor);

    let content = full;
    if (section) {
      const start = headings.find((h) => h.anchor === section);
      if (!start) {
        throw new ValidationError(
          `Section '${section}' not found in ${path}. Available: ${sections.join(", ")}`,
          this.constructor.name,
        );
      }
      const next = headings.find((h) => h.index > start.index && h.level <= start.level);
      content = full.slice(
        start.index,
        next ? next.index : Math.min(start.index + 20_000, full.length),
      );
    }

    logger.info(
      `📄 read_section ${library}:${path}${section ? `#${section}` : ""} (${content.length} chars)`,
    );

    return { url: page.url, title: page.title, content, sections };
  }
}
