import { ScrapeMode } from "../../types";
import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";
import { HtmlDomParserMiddleware } from "./HtmlDomParserMiddleware";
import { HtmlPlaywrightMiddleware } from "./HtmlPlaywrightMiddleware";

/**
 * A content processing middleware that intelligently selects an HTML processing
 * strategy (DOM parsing or Playwright) based on the `scrapeMode` option.
 *
 * - 'fetch': Uses the lightweight `HtmlDomParserMiddleware`.
 * - 'playwright': Uses the full-featured `HtmlPlaywrightMiddleware`.
 * - 'auto': Currently defaults to using `HtmlPlaywrightMiddleware`. Future implementations
 *   might add more sophisticated logic for 'auto' mode.
 */
export class HtmlSelectProcessorMiddleware implements ContentProcessorMiddleware {
  private readonly domProcessor: HtmlDomParserMiddleware;
  private readonly playwrightProcessor: HtmlPlaywrightMiddleware;

  constructor() {
    this.domProcessor = new HtmlDomParserMiddleware();
    this.playwrightProcessor = new HtmlPlaywrightMiddleware();
  }

  /**
   * Processes the content using the pre-instantiated HtmlDomParserMiddleware or HtmlPlaywrightMiddleware
   * based on the scrapeMode specified in the context options, then calls the next middleware.
   * @param context - The content processing context.
   * @param next - A function to call to pass control to the next middleware.
   */
  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Default to Auto if scrapeMode is not provided
    const mode = context.options?.scrapeMode ?? ScrapeMode.Auto;

    let selectedProcessor: ContentProcessorMiddleware;

    if (mode === ScrapeMode.Fetch) {
      selectedProcessor = this.domProcessor;
    } else {
      // Default to Playwright for Playwright and Auto modes
      selectedProcessor = this.playwrightProcessor;
    }

    // Run the selected pre-instantiated processor
    await selectedProcessor.process(context, next);
  }
}
