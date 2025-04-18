import { type DOMWindow, JSDOM } from "jsdom";
import { logger } from "../../../utils/logger";
import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";

/**
 * Middleware to parse HTML string/buffer content into a JSDOM window object.
 * It populates the `context.dom` property.
 */
export class HtmlDomParserMiddleware implements ContentProcessorMiddleware {
  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Only process HTML content
    if (!context.contentType.startsWith("text/html")) {
      await next();
      return;
    }

    // Ensure content is a string for JSDOM
    const htmlString =
      typeof context.content === "string"
        ? context.content
        : Buffer.from(context.content).toString("utf-8");

    let domWindow: DOMWindow | undefined;
    try {
      logger.debug(`Parsing HTML content from ${context.source}`);
      domWindow = new JSDOM(htmlString, {
        url: context.source, // Provide the source URL to JSDOM
        // Consider adding other JSDOM options if needed, e.g., runScripts: "dangerously"
      }).window;

      // Add the DOM window to the context
      context.dom = domWindow;

      // Proceed to the next middleware
      await next();
    } catch (error) {
      logger.error(`Failed to parse HTML for ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`HTML parsing failed: ${String(error)}`),
      );
      // Do not proceed further down the pipeline if parsing fails
      return;
    }
  }
}
