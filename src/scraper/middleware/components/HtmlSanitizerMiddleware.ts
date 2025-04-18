import createDOMPurify, { type DOMPurify, type WindowLike } from "dompurify";
import { logger } from "../../../utils/logger";
import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";

/**
 * Options for HtmlSanitizerMiddleware.
 */
export interface HtmlSanitizerOptions {
  /** CSS selectors for elements to remove *in addition* to the defaults. */
  excludeSelectors?: string[];
}

/**
 * Middleware to sanitize HTML content using DOMPurify and remove unwanted elements.
 * It expects the JSDOM window object (`context.dom`) to be populated by a preceding middleware.
 * It modifies the `context.dom` object in place.
 */
export class HtmlSanitizerMiddleware implements ContentProcessorMiddleware {
  private purify: DOMPurify | null = null;

  // Default selectors to remove (combined from original HtmlElementRemoverMiddleware)
  private readonly defaultSelectorsToRemove = [
    "nav",
    "footer",
    "script",
    "style",
    "noscript",
    "svg",
    "link",
    "meta",
    "iframe",
    "header",
    "button",
    "input",
    "textarea",
    "select",
    // "form", // Keep commented
    ".ads",
    ".advertisement",
    ".banner",
    ".cookie-banner",
    ".cookie-consent",
    ".hidden",
    ".hide",
    ".modal",
    ".nav-bar",
    ".overlay",
    ".popup",
    ".promo",
    ".mw-editsection",
    ".side-bar",
    ".social-share",
    ".sticky",
    "#ads",
    "#banner",
    "#cookieBanner",
    "#modal",
    "#nav",
    "#overlay",
    "#popup",
    "#sidebar",
    "#socialMediaBox",
    "#stickyHeader",
    "#ad-container",
    ".ad-container",
    ".login-form",
    ".signup-form",
    ".tooltip",
    ".dropdown-menu",
    // ".alert", // Keep commented
    ".breadcrumb",
    ".pagination",
    // '[role="alert"]', // Keep commented
    '[role="banner"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="region"][aria-label*="skip" i]',
    '[aria-modal="true"]',
    ".noprint",
  ];

  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Check if DOM window exists
    if (!context.dom) {
      if (context.contentType.startsWith("text/html")) {
        logger.warn(
          `Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlDomParserMiddleware runs before this.`,
        );
      }
      await next();
      return;
    }

    try {
      const { window } = context.dom;
      const { document } = window;

      // 1. Sanitize using DOMPurify
      logger.debug(`Sanitizing HTML content for ${context.source}`);
      this.purify = createDOMPurify(window as unknown as WindowLike);
      // Sanitize the document's body in place.
      // DOMPurify modifies the node directly when RETURN_DOM=true and RETURN_DOM_FRAGMENT=false.
      this.purify.sanitize(document.body, {
        WHOLE_DOCUMENT: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_DOM: true,
        IN_PLACE: true, // Explicitly use in-place modification
      });
      logger.debug(`Sanitization complete for ${context.source}`);

      // 2. Remove unwanted elements
      const selectorsToRemove = [
        ...(context.options.excludeSelectors || []), // Use options from the context
        ...this.defaultSelectorsToRemove,
      ];
      logger.debug(
        `Removing elements matching ${selectorsToRemove.length} selectors for ${context.source}`,
      );
      let removedCount = 0;
      for (const selector of selectorsToRemove) {
        try {
          const elements = document.body.querySelectorAll(selector);
          for (const el of elements) {
            el.remove();
            removedCount++;
          }
        } catch (selectorError) {
          // Log invalid selectors but continue with others
          logger.warn(
            `Invalid selector "${selector}" during element removal: ${selectorError}`,
          );
          context.errors.push(
            new Error(`Invalid selector "${selector}": ${selectorError}`),
          );
        }
      }
      logger.debug(`Removed ${removedCount} elements for ${context.source}`);

      // The context.dom.document has been modified in place.
    } catch (error) {
      logger.error(
        `Error during HTML sanitization/cleaning for ${context.source}: ${error}`,
      );
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`HTML sanitization/cleaning failed: ${String(error)}`),
      );
      // Decide if pipeline should stop? For now, continue.
    } finally {
      // Release DOMPurify instance
      this.purify = null;
    }

    // Proceed to the next middleware
    await next();
  }
}
