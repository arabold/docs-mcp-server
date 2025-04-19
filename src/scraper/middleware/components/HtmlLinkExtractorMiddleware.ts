import { logger } from "../../../utils/logger"; // Added logger
import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";

/**
 * Middleware to extract links (href attributes from <a> tags) from HTML content.
 * It expects the JSDOM window object to be available in `context.dom`.
 * This should run *before* any sanitization/cleaning that might remove links.
 */
export class HtmlLinkExtractorMiddleware implements ContentProcessorMiddleware {
  /**
   * Processes the context to extract links from the sanitized HTML body.
   * @param context The current processing context.
   * @param next Function to call the next middleware.
   */
  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Check if we have a DOM window from a previous step
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
      const { document } = context.dom; // Use the document from the context DOM
      const linkElements = document.querySelectorAll("a[href]"); // Query the whole document

      logger.debug(`Found ${linkElements.length} potential links in ${context.source}`);

      const extractedLinks = Array.from(linkElements)
        .map((el) => el.getAttribute("href"))
        .filter((href): href is string => href !== null && href.trim() !== "") // Ensure href is non-empty string
        .map((href) => {
          try {
            const urlObj = new URL(href, context.source);
            // Explicitly check for valid protocols
            if (!["http:", "https:", "file:"].includes(urlObj.protocol)) {
              logger.debug(`Ignoring link with invalid protocol: ${href}`);
              return null;
            }
            return urlObj.href;
          } catch (e) {
            // Ignore URLs that cause the URL constructor to throw
            logger.debug(`Ignoring invalid URL syntax: ${href}`);
            return null;
          }
        })
        .filter((url): url is string => url !== null); // Filter out nulls

      // Add extracted links to the context, avoiding duplicates if necessary
      // Add extracted links to the context. Using a Set ensures uniqueness.
      context.links = [...new Set(extractedLinks)];
      logger.debug(
        `Extracted ${context.links.length} unique, valid links from ${context.source}`,
      );
    } catch (error) {
      logger.error(`Error extracting links from ${context.source}: ${error}`);
      context.errors.push(
        new Error(
          `Failed to extract links from HTML: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      // Decide if pipeline should stop
    }

    // Call the next middleware in the chain
    await next();

    // No cleanup needed specifically for this middleware as it only reads from context
  }
}
