import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Middleware to extract the title (first H1 heading) from Markdown content.
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
      const match = context.content.match(/^#\s+(.*)$/m);
      if (match?.[1]) {
        title = match[1].trim();
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
