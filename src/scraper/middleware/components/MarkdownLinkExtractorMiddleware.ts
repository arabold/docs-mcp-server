import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";

/**
 * Placeholder middleware for extracting links from Markdown content.
 * Currently, it does not implement link extraction, matching the
 * original MarkdownProcessor's TODO status.
 */
export class MarkdownLinkExtractorMiddleware implements ContentProcessorMiddleware {
  /**
   * Processes the context. Currently a no-op regarding link extraction.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    if (context.contentType === "text/markdown") {
      // TODO: Implement Markdown link extraction (e.g., using regex or a Markdown parser)
      // For now, ensure context.links exists, defaulting to empty array if not set.
      if (!Array.isArray(context.links)) {
        context.links = [];
      }
      // No links are added here yet.
    }

    // Call the next middleware in the chain
    await next();

    // No cleanup needed
  }
}
