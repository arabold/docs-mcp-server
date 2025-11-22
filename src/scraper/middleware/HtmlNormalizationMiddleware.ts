import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Middleware that normalizes URLs and links in HTML content after DOM parsing.
 *
 * This middleware performs the following transformations:
 * - Converts relative image URLs to absolute URLs
 * - Converts relative link URLs to absolute URLs
 * - Removes anchor links (#...) but preserves their text content
 * - Removes non-HTTP links (javascript:, mailto:, etc.) but preserves their text content
 *
 * This ensures that indexed documents contain functional absolute URLs and removes
 * non-functional links while preserving contextually valuable text content.
 */
export class HtmlNormalizationMiddleware implements ContentProcessorMiddleware {
  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    if (!context.dom) {
      logger.debug(
        `Skipping HTML normalization for ${context.source} - no DOM available`,
      );
      await next();
      return;
    }

    try {
      logger.debug(`Normalizing HTML URLs and links for ${context.source}`);

      const $ = context.dom;
      const baseUrl = context.source;

      // Normalize image URLs
      this.normalizeImageUrls($, baseUrl);

      // Normalize and clean links
      this.normalizeLinks($, baseUrl);

      logger.debug(`Successfully normalized HTML content for ${context.source}`);
    } catch (error) {
      logger.error(`❌ Failed to normalize HTML for ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`HTML normalization failed: ${String(error)}`),
      );
    }

    await next();
  }

  /**
   * Normalizes image URLs by converting relative URLs to absolute URLs.
   */
  private normalizeImageUrls($: cheerio.CheerioAPI, baseUrl: string): void {
    $("img").each((_index, element) => {
      const $img = $(element);
      const src = $img.attr("src");

      if (!src) return;

      try {
        // If it's already an absolute URL, leave it unchanged
        new URL(src);
      } catch {
        // It's a relative URL, convert to absolute
        try {
          const absoluteUrl = new URL(src, baseUrl).href;
          $img.attr("src", absoluteUrl);
        } catch (error) {
          logger.debug(`Failed to resolve relative image URL: ${src} - ${error}`);
        }
      }
    });
  }

  /**
   * Normalizes links by:
   * - Converting relative URLs to absolute URLs
   * - Unwrapping anchor links (preserving text content)
   * - Unwrapping non-HTTP links (preserving text content)
   */
  private normalizeLinks($: cheerio.CheerioAPI, baseUrl: string): void {
    $("a").each((_index, element) => {
      const $link = $(element);
      const href = $link.attr("href");

      if (!href) {
        // Links without href - unwrap them (preserve content, remove tag)
        this.unwrapElement($, $link);
        return;
      }

      // Handle anchor links (starting with #)
      if (href.startsWith("#")) {
        this.unwrapElement($, $link);
        return;
      }

      // Check if it's already an absolute URL
      try {
        const url = new URL(href);

        // Handle non-HTTP protocols (javascript:, mailto:, etc.)
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          this.unwrapElement($, $link);
          return;
        }

        // It's already a valid HTTP/HTTPS absolute URL, leave it unchanged
      } catch {
        // It's a relative URL, convert to absolute
        try {
          const absoluteUrl = new URL(href, baseUrl).href;
          $link.attr("href", absoluteUrl);
        } catch (error) {
          logger.debug(`Failed to resolve relative link URL: ${href} - ${error}`);
          // If we can't resolve it, unwrap it to preserve the text content
          this.unwrapElement($, $link);
        }
      }
    });
  }

  /**
   * Unwraps an element by replacing it with its HTML content.
   * This preserves the inner HTML (including nested elements) while removing the wrapping tag.
   */
  private unwrapElement(
    _$: cheerio.CheerioAPI,
    $element: cheerio.Cheerio<AnyNode>,
  ): void {
    const htmlContent = $element.html() || $element.text();
    $element.replaceWith(htmlContent);
  }
}
