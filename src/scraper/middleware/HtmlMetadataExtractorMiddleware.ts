import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Middleware to extract the title from HTML content using Cheerio.
 * Assumes context.dom (Cheerio API object) is populated by a preceding middleware
 * (e.g., HtmlCheerioParserMiddleware).
 */
export class HtmlMetadataExtractorMiddleware implements ContentProcessorMiddleware {
  /**
   * Processes the context to extract the HTML title.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    // Check if Cheerio DOM exists from previous middleware
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware runs before this.`,
      );
      await next();
      return;
    }

    // Only process if we have a Cheerio object (implicitly means it's HTML)
    try {
      // Extract title (using title tag, fallback to h1 if title is empty/missing)
      let title = $("title").first().text().trim();

      if (!title) {
        // Fallback to the first H1 if title is empty
        title = $("h1").first().text().trim();
      }

      // Default to "Untitled" if both are empty
      title = title || "Untitled";

      // Basic cleanup (replace multiple spaces with single space)
      title = title.replace(/\s+/g, " ").trim();

      context.title = title;
      logger.debug(`Extracted title: "${title}" from ${context.source}`);
    } catch (error) {
      logger.error(`❌ Error extracting metadata from ${context.source}: ${error}`);
      context.errors.push(
        new Error(
          `Failed to extract metadata from HTML: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      // Optionally decide whether to stop the pipeline here
    }

    // Call the next middleware in the chain
    await next();

    // No cleanup needed for Cheerio
  }
}
