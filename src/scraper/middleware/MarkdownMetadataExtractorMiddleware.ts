import matter from "gray-matter";
import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Middleware to extract the title from Markdown content.
 * Prioritizes YAML frontmatter 'title' field, falls back to first H1 heading.
 */
export class MarkdownMetadataExtractorMiddleware implements ContentProcessorMiddleware {
  /**
   * Processes the context to extract the title from Markdown.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    try {
      let title = "Untitled";
      let frontmatterTitle: string | undefined;

      // 1. Try to extract title from YAML frontmatter
      try {
        const file = matter(context.content);
        if (file.data && typeof file.data.title === "string") {
          frontmatterTitle = file.data.title.trim();
        }
      } catch (err) {
        // Log warning but continue - don't crash the pipeline for bad frontmatter
        logger.warn(
          `Failed to parse markdown frontmatter: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (frontmatterTitle) {
        title = frontmatterTitle;
      } else {
        // 2. Fallback: Extract first H1 heading
        const match = context.content.match(/^#\s+(.*)$/m);
        if (match?.[1]) {
          title = match[1].trim();
        }
      }

      context.title = title;
    } catch (error) {
      context.errors.push(
        new Error(
          `Failed to extract metadata from Markdown: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }

    await next();
  }
}
