import { logger } from "../../../utils/logger"; // Added logger
import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";
// Removed JSDOM and DOMWindow imports as parsing is done upstream

/**
 * Middleware to extract the title from HTML content.
 * Assumes context.dom is populated by a preceding middleware (e.g., HtmlDomParserMiddleware).
 */
export class HtmlMetadataExtractorMiddleware implements ContentProcessorMiddleware {
  /**
   * Processes the context to extract the HTML title.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Check if DOM window exists from previous middleware
    if (!context.dom) {
      // Log a warning if running on HTML content without a DOM
      if (context.contentType.startsWith("text/html")) {
        logger.warn(
          `Skipping ${this.constructor.name}: context.dom is missing for HTML content. Ensure HtmlDomParserMiddleware runs before this.`,
        );
      }
      // Otherwise, just proceed (might be non-HTML content)
      await next();
      return;
    }

    // Only process if we have a DOM (implicitly means it's HTML)
    try {
      const { document } = context.dom; // Use the DOM from context

      // Extract title (using h1 as primary, title as fallback)
      let title =
        // document.querySelector("h1")?.textContent?.trim() ||
        document.querySelector("title")?.textContent?.trim() || "Untitled"; // Default to Untitled

      // Basic cleanup
      title = title.replace(/\s+/g, " ").trim();

      context.metadata.title = title;
      logger.debug(`Extracted title: "${title}" from ${context.source}`);
    } catch (error) {
      logger.error(`Error extracting metadata from ${context.source}: ${error}`);
      context.errors.push(
        new Error(
          `Failed to extract metadata from HTML: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      // Optionally decide whether to stop the pipeline here
    }

    // Call the next middleware in the chain
    await next();

    // No cleanup needed here as the parser middleware handles closing the window
  }
}
