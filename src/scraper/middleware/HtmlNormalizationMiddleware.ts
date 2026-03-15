import type * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Middleware that normalizes URLs and links in HTML content after DOM parsing.
 *
 * This middleware performs the following transformations:
 * - Converts relative image URLs to absolute URLs
 * - Removes tracking/ad images (1x1 pixels, analytics beacons)
 * - Converts relative link URLs to absolute URLs
 * - Removes anchor links (#...) but preserves their text content
 * - Removes non-HTTP links (javascript:, mailto:, etc.) but preserves their text content
 *
 * This ensures that indexed documents contain functional absolute URLs and removes
 * non-functional links while preserving contextually valuable text content.
 */
export class HtmlNormalizationMiddleware implements ContentProcessorMiddleware {
  private readonly presentationalAnchorWrapperTags = new Set(["div", "p"]);

  // Known tracking/analytics domains and patterns to filter out
  private readonly trackingPatterns = [
    "adroll.com",
    "doubleclick.net",
    "google-analytics.com",
    "googletagmanager.com",
    "analytics.twitter.com",
    "twitter.com/1/i/adsct",
    "t.co/1/i/adsct",
    "bat.bing.com",
    "pixel.rubiconproject.com",
    "casalemedia.com",
    "tremorhub.com",
    "rlcdn.com",
    "facebook.com/tr",
    "linkedin.com/px",
    "quantserve.com",
    "scorecardresearch.com",
    "hotjar.com",
    "mouseflow.com",
    "crazyegg.com",
    "clarity.ms",
  ];
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

      // Simplify purely presentational wrappers inside links before markdown conversion
      this.simplifyAnchorContent($);

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
   * Checks if an image should be kept based on its source URL.
   * Filters out tracking pixels and analytics beacons.
   */
  private shouldKeepImage(src: string): boolean {
    const srcLower = src.toLowerCase();
    return !this.trackingPatterns.some((pattern) => srcLower.includes(pattern));
  }

  /**
   * Normalizes image URLs by converting relative URLs to absolute URLs.
   * Removes tracking/analytics images.
   * Preserves data URIs (inline images).
   */
  private normalizeImageUrls($: cheerio.CheerioAPI, baseUrl: string): void {
    $("img").each((_index, element) => {
      const $img = $(element);
      const src = $img.attr("src");

      if (!src) {
        // Remove images without src
        $img.remove();
        return;
      }

      // Keep data URIs (inline images) as-is
      if (src.startsWith("data:")) {
        return;
      }

      // Check if this is a tracking image
      if (!this.shouldKeepImage(src)) {
        $img.remove();
        return;
      }

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
          // Remove images we can't resolve
          $img.remove();
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
   * Removes single presentational block wrappers inside anchors so Turndown does not
   * emit multi-line link labels for layout-only structures.
   */
  private simplifyAnchorContent($: cheerio.CheerioAPI): void {
    $("a").each((_index, element) => {
      const $link = $(element);
      let simplified = true;

      while (simplified) {
        simplified = false;

        const significantChildren = $link
          .contents()
          .toArray()
          .filter((node) => node.type !== "text" || (node.data || "").trim().length > 0);

        if (significantChildren.length !== 1) {
          continue;
        }

        const wrapperNode = significantChildren[0];
        if (wrapperNode.type !== "tag") {
          continue;
        }

        const tagName = wrapperNode.tagName.toLowerCase();
        if (!this.presentationalAnchorWrapperTags.has(tagName)) {
          continue;
        }

        const $wrapper = $(wrapperNode);
        if (this.hasProtectedDescendants($wrapper)) {
          continue;
        }

        this.insertSpacesBetweenSiblingTextFragments($, $wrapper);
        $wrapper.replaceWith($wrapper.contents());
        simplified = true;
      }
    });
  }

  private hasProtectedDescendants($element: cheerio.Cheerio<AnyNode>): boolean {
    return $element.find("img, pre, table, ul, ol, li, blockquote").length > 0;
  }

  private insertSpacesBetweenSiblingTextFragments(
    $: cheerio.CheerioAPI,
    $element: cheerio.Cheerio<AnyNode>,
  ): void {
    const children = $element.contents().toArray();

    for (let index = 1; index < children.length; index++) {
      const previousNode = children[index - 1];
      const currentNode = children[index];

      if (
        !this.nodeHasVisibleText($, previousNode) ||
        !this.nodeHasVisibleText($, currentNode)
      ) {
        continue;
      }

      if (this.hasWhitespaceBoundary($, previousNode, currentNode)) {
        continue;
      }

      $(currentNode).before(" ");
    }
  }

  private nodeHasVisibleText($: cheerio.CheerioAPI, node: AnyNode): boolean {
    if (node.type === "text") {
      return (node.data || "").trim().length > 0;
    }

    return $(node).text().trim().length > 0;
  }

  private hasWhitespaceBoundary(
    $: cheerio.CheerioAPI,
    previousNode: AnyNode,
    currentNode: AnyNode,
  ): boolean {
    const previousText = this.getNodeText($, previousNode);
    const currentText = this.getNodeText($, currentNode);

    return /\s$/.test(previousText) || /^\s/.test(currentText);
  }

  private getNodeText($: cheerio.CheerioAPI, node: AnyNode): string {
    if (node.type === "text") {
      return node.data || "";
    }

    return $(node).text();
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
