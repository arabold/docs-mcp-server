import type * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Minimum share of the sanitized body's visible text that the main-content
 * region must hold before extraction is scoped to it. Tuning value: measured
 * across a sample of documentation sites the region holds >98% of the
 * remaining text, so a floor of 0.5 never fires on a well-formed page while
 * still refusing to scope when `<main>` marks a small decorative shell and
 * the real content lives elsewhere.
 */
const MAIN_CONTENT_MIN_TEXT_RATIO = 0.5;

/**
 * Length of an element's text as a reader would see it, with runs of
 * whitespace collapsed to a single space.
 *
 * Cheerio's `.text()` returns raw text nodes, so on pretty-printed markup the
 * indentation between tags counts as content. That matters for the
 * main-content ratio: removing a chrome element leaves its surrounding
 * whitespace node behind, outside the content region, which deflates the
 * region's measured share and can push a dominant `<main>` below the floor.
 */
function visibleTextLength(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}

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
 *
 * Sanitization runs in two passes:
 * 1. Selector removal — strips known chrome, ads, and search widgets.
 * 2. Main-content scoping — when the page declares its content region with
 *    `<main>` or `role="main"`, everything outside that region is dropped.
 *    This catches site-specific promo banners and sponsor blocks that no
 *    selector list can enumerate. Guarded by
 *    {@link MAIN_CONTENT_MIN_TEXT_RATIO} so a page whose content sits outside
 *    the declared region is left untouched.
 */
export class HtmlSanitizerMiddleware implements ContentProcessorMiddleware {
  // Default selectors to remove
  private readonly defaultSelectorsToRemove = [
    "aside",
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
    ".mobile-menu",
    ".mobile-nav",
    ".modal",
    ".nav-bar",
    ".overlay",
    ".popup",
    ".promo",
    ".mw-editsection",
    ".search-bar",
    ".search-form",
    ".side-bar",
    ".sidebar",
    ".social-share",
    ".sticky",
    ".table-of-contents",
    ".toc",
    "#ads",
    "#banner",
    "#cookieBanner",
    "#mobile-menu",
    "#mobile-nav",
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
    '[role="complementary"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="navigation"]',
    '[role="search"]',
    '[role="region"][aria-label*="skip" i]',
    '[aria-modal="true"]',
    ".noprint",
    // Skip-links and screen-reader-only anchors (e.g. "Skip to main content").
    // Scoped to <a> so icon-button labels (`<span class="sr-only">`) are left alone.
    "a.sr-only",
    "a.skip-link",
    "a.skip-nav",
    "a.screen-reader-only",
    "a.visually-hidden",
    // Breadcrumb variants beyond the .breadcrumb class above (ARIA + schema.org).
    '[aria-label="Breadcrumb" i]',
    '[itemtype*="BreadcrumbList"]',
    // Ad networks — removed at sanitization time (after render) rather than at
    // network level, to avoid triggering anti-adblock detection on monetized
    // sites. See subresourceBlocklist.ts for the rationale on why ads are not
    // network-blocked.
    // Carbon Ads (Vite, Astro, Tailwind, MDN, …)
    "#carbonads",
    ".carbonads",
    ".carbon-wrap",
    ".carbon-text",
    ".carbon-img",
    ".carbon-poweredby",
    // Scoped to the click-redirect host (srv.carbonads.net) rather than the
    // apex domain so that legitimate prose links to carbonads.net survive.
    'a[href*="srv.carbonads.net"]',
    // BuySellAds
    ".bsa-promotion",
    ".bsa-cpc",
    '[id^="bsap_"]',
    '[id^="bsa-zone_"]',
    'img[src*="buysellads.com"]',
    'img[src*="buysellads.net"]',
    // EthicalAds (ReadTheDocs, Python/Django docs)
    ".ethical-rtd",
    ".ethical-fixedfooter",
    ".ethical-bottom-right",
    "[data-ea-publisher]",
    ".keep-us-sustainable",
    'img[src*="ethicalads.io"]',
    // Google AdSense
    ".adsbygoogle",
    "ins.adsbygoogle",
    '[id^="google_ads_iframe"]',
    'img[src*="googlesyndication.com"]',
    'img[src*="doubleclick.net"]',
    // Outbrain / Taboola — content-recommendation widgets, indistinguishable
    // from ads on doc pages.
    ".OUTBRAIN",
    '[data-widget-id^="OB_"]',
    ".taboola",
    '[id^="taboola-"]',
    // Tracker pixels that escape via async injection
    'img[src*="bidr.io"]',
    'img[src*="adnxs.com"]',
    'img[src*="adsrvr.org"]',
    'img[src*="analytics.yahoo.com"]',
    // Third-party search widgets injected outside of nav/header.
    // Algolia DocSearch (dominant in technical docs)
    ".DocSearch",
    ".DocSearch-Button",
    ".DocSearch-Container",
    ".DocSearch-Modal",
    "#docsearch",
    '[id^="docsearch-"]',
    ".algolia-autocomplete",
    ".algolia-docsearch-suggestion",
    // MkDocs Material result containers (the search box is in nav; results can
    // render standalone)
    ".md-search-result",
    ".md-search__output",
    // Sphinx / ReadTheDocs search
    "#searchbox",
    "#search-results",
    ".wy-side-search",
    // Swiftype / Elastic Site Search
    "#st-search-input",
    "#st-results-container",
    ".st-default-search-input",
  ];

  /**
   * Replace the body with the page's main-content region, when the page
   * declares one and it holds the bulk of the remaining visible text.
   *
   * Runs after selector removal so the ratio is measured against content that
   * already has nav, footers, ads, and search widgets stripped — at that point
   * anything still outside `<main>` is site chrome (promo banners, sponsor
   * strips, cookie notices, keyboard-shortcut help).
   *
   * @param $ The Cheerio DOM, modified in place.
   * @param source Source URL, used for logging only.
   */
  private scopeToMainContent($: cheerio.CheerioAPI, source: string): void {
    const candidates = $("main").length > 0 ? $("main") : $('[role="main"]');
    if (candidates.length === 0) return;

    // Pick the text-richest candidate. Pages occasionally carry more than one
    // `<main>` (invalid but common), or nest `role="main"` inside `<main>`.
    let best: Element | undefined;
    let bestLength = 0;
    candidates.each((_, element) => {
      const tagName = $(element).prop("tagName")?.toLowerCase();
      if (tagName === "html" || tagName === "body") return;
      const length = visibleTextLength($(element).text());
      if (length > bestLength) {
        bestLength = length;
        best = element;
      }
    });
    if (!best || bestLength === 0) return;

    const bodyLength = visibleTextLength($("body").text());
    if (bodyLength === 0) return;

    const ratio = bestLength / bodyLength;
    if (ratio < MAIN_CONTENT_MIN_TEXT_RATIO) {
      logger.debug(
        `Main-content region holds only ${(ratio * 100).toFixed(1)}% of the text for ${source}; keeping full body`,
      );
      return;
    }

    const kept = $(best).clone();
    $("body").empty().append(kept);
    logger.debug(
      `Scoped content to main region (${bestLength}/${bodyLength} chars) for ${source}`,
    );
  }

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

      // Second pass: narrow to the page's declared main-content region.
      this.scopeToMainContent($, context.source);

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
