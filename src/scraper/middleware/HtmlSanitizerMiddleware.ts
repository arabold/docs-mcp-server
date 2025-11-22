import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Options for HtmlSanitizerMiddleware.
 */
export interface HtmlSanitizerOptions {
  /** CSS selectors for elements to remove *in addition* to the defaults. */
  excludeSelectors?: string[];
}

/**
 * Middleware to remove unwanted elements from parsed HTML content using Cheerio.
 * It expects the Cheerio API object (`context.dom`) to be populated by a preceding middleware
 * (e.g., HtmlCheerioParserMiddleware).
 * It modifies the `context.dom` object in place.
 */
export class HtmlSanitizerMiddleware implements ContentProcessorMiddleware {
  // Default selectors to remove
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

  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    // Check if Cheerio DOM exists
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware runs before this.`,
      );
      await next();
      return;
    }

    try {
      // Capture the body content before sanitization for safety net
      const bodyBeforeSanitization = $("body").html() || "";
      const textLengthBefore = $("body").text().trim().length;

      // Remove unwanted elements using Cheerio
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
          const elements = $(selector); // Use Cheerio selector
          // Filter out html and body tags to prevent removing them or their entire content
          const filteredElements = elements.filter(function () {
            const tagName = $(this).prop("tagName")?.toLowerCase();
            return tagName !== "html" && tagName !== "body";
          });
          const count = filteredElements.length;
          if (count > 0) {
            filteredElements.remove(); // Use Cheerio remove
            removedCount += count;
          }
        } catch (selectorError) {
          // Log invalid selectors but continue with others
          // Cheerio is generally more tolerant of invalid selectors than querySelectorAll
          logger.warn(
            `⚠️  Potentially invalid selector "${selector}" during element removal: ${selectorError}`,
          );
          context.errors.push(
            new Error(`Invalid selector "${selector}": ${selectorError}`),
          );
        }
      }
      logger.debug(`Removed ${removedCount} elements for ${context.source}`);

      // Safety net: Check if sanitization removed all content
      const textLengthAfter = $("body").text().trim().length;
      if (textLengthBefore > 0 && textLengthAfter === 0) {
        logger.warn(
          `⚠️  Sanitization removed all content from ${context.source}. Reverting to pre-sanitization state.`,
        );
        // Restore the body content
        $("body").html(bodyBeforeSanitization);
      }

      // The context.dom object ($) has been modified in place.
    } catch (error) {
      logger.error(
        `❌ Error during HTML element removal for ${context.source}: ${error}`,
      );
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`HTML element removal failed: ${String(error)}`),
      );
      // Decide if pipeline should stop? For now, continue.
    }

    // Proceed to the next middleware
    await next();
  }
}
