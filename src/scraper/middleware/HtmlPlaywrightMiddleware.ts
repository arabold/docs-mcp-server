import type { Browser, BrowserContext, ElementHandle, Frame, Page } from "playwright";
import { type AppConfig, defaults } from "../../utils/config";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { BrowserFetcher } from "../fetcher";
import { ScrapeMode } from "../types";
import { SimpleMemoryCache } from "../utils/SimpleMemoryCache";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Shadow DOM mapping structure for non-invasive extraction
 */
interface ShadowMapping {
  shadowContent: string;
  hostTagName: string;
  hostClasses: string;
  hostId: string;
  hostOuterHTML: string;
  elementIndex: number;
  parentTagName: string;
  positionTop: number;
  positionLeft: number;
}

/**
 * Cached resource structure containing body and content type
 */
interface CachedResource {
  body: string;
  contentType: string;
}

/**
 * Middleware to process HTML content using Playwright for rendering dynamic content,
 * *if* the scrapeMode option requires it ('playwright' or 'auto').
 * It updates `context.content` with the rendered HTML if Playwright runs.
 * Subsequent middleware (e.g., HtmlCheerioParserMiddleware) should handle parsing this content.
 *
 * This middleware also supports URLs with embedded credentials (user:password@host) and ensures
 * credentials are used for all same-origin resource requests (not just the main page) via HTTP Basic Auth.
 *
 * Additionally, all custom headers from context.options?.headers are forwarded to Playwright requests.
 */
export class HtmlPlaywrightMiddleware implements ContentProcessorMiddleware {
  private browser: Browser | null = null;
  private readonly config: AppConfig["scraper"];

  // Static LRU cache for all fetched resources, shared across instances
  private static readonly resourceCache = new SimpleMemoryCache<string, CachedResource>(
    defaults.scraper.fetcher.maxCacheItems,
  );

  constructor(config: AppConfig["scraper"]) {
    this.config = config;
  }

  /**
   * Initializes the Playwright browser instance.
   * Consider making this more robust (e.g., lazy initialization, singleton).
   */
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      logger.debug("Launching new Playwright browser instance (Chromium)");
      this.browser = await BrowserFetcher.launchBrowser();
      this.browser.on("disconnected", () => {
        logger.debug("Playwright browser instance disconnected.");
        this.browser = null;
      });
    }
    return this.browser;
  }

  /**
   * Closes the Playwright browser instance if it exists.
   * Should be called during application shutdown.
   * Attempts to close even if the browser is disconnected to ensure proper cleanup of zombie processes.
   */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        logger.debug("Closing Playwright browser instance...");
        // Always attempt to close, even if disconnected, to reap zombie processes
        await this.browser.close();
      } catch (error) {
        // Log error but don't throw - cleanup should be non-fatal
        logger.warn(`⚠️  Error closing Playwright browser: ${error}`);
      } finally {
        // Always set to null to allow fresh browser on next request
        this.browser = null;
      }
    }
  }

  /**
   * Injects the shadow DOM extractor script into the page.
   * This script performs non-invasive extraction that preserves document structure.
   * The extraction function is called just-in-time when content is actually needed, ensuring we capture
   * the final state of all shadow DOMs after page loading is complete.
   * Returns an array of shadow mappings directly (empty array = no shadow DOMs found).
   */
  private async injectShadowDOMExtractor(page: Page): Promise<void> {
    await page.addInitScript(`
      window.shadowExtractor = {
        extract() {
          // Extract shadow DOM mappings
          const shadowMappings = [];
          
          function createShadowMapping(root, depth = 0) {
            if (depth > 15) return;
            
            // Use TreeWalker to traverse in document order
            const walker = document.createTreeWalker(
              root,
              NodeFilter.SHOW_ELEMENT,
              null,
              false
            );
            
            let currentNode = walker.nextNode();
            while (currentNode) {
              const element = currentNode;
              if (element.shadowRoot) {
                try {
                  // Extract shadow DOM content without modifying anything
                  const shadowChildren = Array.from(element.shadowRoot.children);
                  const shadowHTML = shadowChildren.map(child => child.outerHTML).join('\\n');
                  
                  if (shadowHTML.trim()) {
                    // Get position info for precise insertion later
                    const rect = element.getBoundingClientRect();
                    const elementIndex = Array.from(element.parentNode?.children || []).indexOf(element);
                    
                    shadowMappings.push({
                      shadowContent: shadowHTML,
                      hostTagName: element.tagName,
                      hostClasses: element.className || '',
                      hostId: element.id || '',
                      hostOuterHTML: element.outerHTML,
                      elementIndex: elementIndex,
                      parentTagName: element.parentNode?.tagName || '',
                      positionTop: rect.top,
                      positionLeft: rect.left
                    });
                  }
                  
                  // Recursively process nested shadow DOMs
                  createShadowMapping(element.shadowRoot, depth + 1);
                  
                } catch (error) {
                  console.debug('Shadow DOM access error:', error);
                }
              }
              currentNode = walker.nextNode();
            }
          }
          
          createShadowMapping(document);
          
          return shadowMappings;
        }
      };
      
    `);
  }

  /**
   * Extracts content using either shadow DOM non-invasive extraction or standard page.content() method.
   * Returns the extracted content and the method used.
   *
   * Performs just-in-time shadow DOM extraction after all page loading is complete.
   */
  private async extractContentWithShadowDOMSupport(page: Page): Promise<{
    content: string;
    method: string;
  }> {
    // Force fresh extraction right now (when everything is loaded)
    const [shadowMappings, originalPageContent] = await Promise.all([
      page.evaluate(() => {
        // Extract fresh data right now - just-in-time extraction
        // biome-ignore lint/suspicious/noExplicitAny: no type for injected script
        return (window as any).shadowExtractor?.extract() || [];
      }),
      page.content(),
    ]);

    if (shadowMappings.length === 0) {
      // No shadow DOMs - use standard page.content()
      logger.debug("No shadow DOMs detected - using page.content()");
      return { content: originalPageContent, method: "page.content()" };
    } else {
      // Shadow DOMs found - combine content outside the browser (non-invasive)
      logger.debug(
        `Shadow DOMs detected - found ${shadowMappings.length} shadow host(s)`,
      );
      logger.debug("Combining content outside browser (non-invasive)");

      // Combine original content with shadow content outside the browser
      const finalContent = this.combineContentSafely(originalPageContent, shadowMappings);
      return { content: finalContent, method: "non-invasive shadow DOM extraction" };
    }
  }

  /**
   * Waits for common loading indicators (spinners, loaders) that are currently visible to disappear from the page or frame.
   * Only waits for selectors that are present and visible at the time of check.
   *
   * @param pageOrFrame The Playwright page or frame instance to operate on.
   */
  private async waitForLoadingToComplete(
    pageOrFrame:
      | Page
      | { waitForSelector: Page["waitForSelector"]; isVisible: Page["isVisible"] },
  ): Promise<void> {
    const commonLoadingSelectors = [
      '[class*="loading"]',
      '[class*="spinner"]',
      '[class*="loader"]',
      '[id*="loading"]',
      '[class*="preload"]',
      "#loading",
      '[aria-label*="loading" i]',
      '[aria-label*="spinner" i]',
    ];

    // Wait for all visible loading indicators in parallel
    const waitPromises: Promise<unknown>[] = [];
    for (const selector of commonLoadingSelectors) {
      try {
        // Use page.isVisible to check if any matching element is visible (legacy API, but works for any visible match)
        const isVisible = await pageOrFrame.isVisible(selector).catch(() => false);
        if (isVisible) {
          waitPromises.push(
            pageOrFrame
              .waitForSelector(selector, {
                state: "hidden",
                timeout: this.config.pageTimeoutMs,
              })
              .catch(() => {}),
          );
        }
      } catch {
        // Ignore errors (e.g., selector not found or timeout)
      }
    }
    if (waitPromises.length > 0) {
      await Promise.all(waitPromises);
    }
  }

  /**
   * Waits for all iframes on the page to load their content.
   * For each iframe, waits for the body to appear and loading indicators to disappear.
   *
   * @param page The Playwright page instance to operate on.
   */
  private async waitForIframesToLoad(page: Page): Promise<void> {
    try {
      // Get all iframe elements
      const iframes = await page.$$("iframe");
      if (iframes.length === 0) {
        return;
      }

      logger.debug(`Found ${iframes.length} iframe(s) on ${page.url()}`);

      // Wait for all iframes to load in parallel
      const iframePromises = iframes.map((iframe, index) =>
        this.processIframe(page, iframe, index),
      );

      await Promise.all(iframePromises);
      logger.debug(`Finished waiting for all iframes to load`);
    } catch (error) {
      logger.debug(`Error during iframe loading for ${page.url()}: ${error}`);
    }
  }

  /**
   * Processes a single iframe: validates, extracts content, and replaces in main page.
   *
   * @param page The main page containing the iframe
   * @param iframe The iframe element handle
   * @param index The iframe index for logging/identification
   */
  private async processIframe(
    page: Page,
    iframe: ElementHandle,
    index: number,
  ): Promise<void> {
    try {
      const src = await iframe.getAttribute("src");
      if (this.shouldSkipIframeSrc(src)) {
        logger.debug(`Skipping iframe ${index + 1} - no valid src (${src})`);
        return;
      }

      logger.debug(`Waiting for iframe ${index + 1} to load: ${src}`);

      // Get the frame content
      const frame = await iframe.contentFrame();
      if (!frame) {
        logger.debug(`Could not access content frame for iframe ${index + 1}`);
        return;
      }

      // Wait for the iframe body to load - if this times out, skip the rest of processing
      try {
        await frame.waitForSelector("body", {
          timeout: this.config.pageTimeoutMs,
        });
      } catch {
        logger.debug(
          `Timeout waiting for body in iframe ${index + 1} - skipping content extraction`,
        );
        return;
      }

      // Wait for loading indicators in the iframe to complete (with timeout protection)
      try {
        await this.waitForLoadingToComplete(frame);
      } catch {
        logger.debug(
          `Timeout waiting for loading indicators in iframe ${index + 1} - proceeding anyway`,
        );
      }

      // Extract and replace iframe content (with timeout protection)
      let content: string | null = null;
      try {
        content = await this.extractIframeContent(frame);
      } catch (error) {
        logger.debug(`Error extracting content from iframe ${index + 1}: ${error}`);
        return;
      }

      if (content && content.trim().length > 0) {
        await this.replaceIframeWithContent(page, index, content);
        logger.debug(
          `Successfully extracted and replaced content for iframe ${index + 1}: ${src}`,
        );
      } else {
        logger.debug(`Iframe ${index + 1} body content is empty: ${src}`);
      }

      logger.debug(`Successfully loaded iframe ${index + 1}: ${src}`);
    } catch (error) {
      logger.debug(`Error processing iframe ${index + 1}: ${error}`);
    }
  }

  /**
   * Determines if an iframe src should be skipped during processing.
   *
   * @param src The iframe src attribute value
   * @returns true if the iframe should be skipped
   */
  private shouldSkipIframeSrc(src: string | null): boolean {
    return (
      !src ||
      src.startsWith("data:") ||
      src.startsWith("javascript:") ||
      src === "about:blank"
    );
  }

  /**
   * Extracts the body innerHTML from an iframe.
   *
   * @param frame The iframe's content frame
   * @returns The extracted HTML content or null if extraction fails
   */
  private async extractIframeContent(frame: Frame): Promise<string | null> {
    try {
      return await frame.$eval("body", (el: HTMLElement) => el.innerHTML);
    } catch (error) {
      logger.debug(`Error extracting iframe content: ${error}`);
      return null;
    }
  }

  /**
   * Replaces an iframe element with its extracted content in the main page.
   *
   * @param page The main page containing the iframe
   * @param index The iframe index (0-based)
   * @param content The extracted content to replace the iframe with
   */
  private async replaceIframeWithContent(
    page: Page,
    index: number,
    content: string,
  ): Promise<void> {
    await page.evaluate(
      (args: [number, string]) => {
        const [iframeIndex, bodyContent] = args;
        const iframe = document.querySelectorAll("iframe")[iframeIndex];
        if (iframe && bodyContent) {
          // Create a replacement div with the iframe content
          const replacement = document.createElement("div");
          replacement.innerHTML = bodyContent;

          // Replace the iframe with the extracted content
          iframe.parentNode?.replaceChild(replacement, iframe);
        }
      },
      [index, content] as [number, string],
    );
  }

  /**
   * Waits for and processes framesets on the page by extracting content from each frame
   * and replacing the frameset with merged content.
   *
   * @param page The Playwright page instance to operate on.
   */
  private async waitForFramesetsToLoad(page: Page): Promise<void> {
    try {
      // Check if the page contains framesets
      const framesets = await page.$$("frameset");
      if (framesets.length === 0) {
        return;
      }

      logger.debug(`Found ${framesets.length} frameset(s) on ${page.url()}`);

      // Extract all frame URLs from the frameset structure
      const frameUrls = await this.extractFrameUrls(page);
      if (frameUrls.length === 0) {
        logger.debug("No frame URLs found in framesets");
        return;
      }

      logger.debug(`Found ${frameUrls.length} frame(s) to process`);

      // Fetch content from each frame
      const frameContents: Array<{ url: string; content: string; name?: string }> = [];
      for (const frameInfo of frameUrls) {
        try {
          const content = await this.fetchFrameContent(page, frameInfo.src);
          if (content && content.trim().length > 0) {
            frameContents.push({
              url: frameInfo.src,
              content,
              name: frameInfo.name,
            });
            logger.debug(`Successfully fetched content from frame: ${frameInfo.src}`);
          } else {
            logger.debug(`Frame content is empty: ${frameInfo.src}`);
          }
        } catch (error) {
          logger.debug(`Error fetching frame content from ${frameInfo.src}: ${error}`);
        }
      }

      // Merge frame contents and replace frameset
      if (frameContents.length > 0) {
        await this.mergeFrameContents(page, frameContents);
        logger.debug(
          `Successfully merged ${frameContents.length} frame(s) into main page`,
        );
      }

      logger.debug(`Finished processing framesets`);
    } catch (error) {
      logger.debug(`Error during frameset processing for ${page.url()}: ${error}`);
    }
  }

  /**
   * Extracts frame URLs from all framesets on the page in document order.
   *
   * @param page The Playwright page instance to operate on.
   * @returns Array of frame information objects with src and optional name.
   */
  private async extractFrameUrls(
    page: Page,
  ): Promise<Array<{ src: string; name?: string }>> {
    try {
      return await page.evaluate(() => {
        const frames: Array<{ src: string; name?: string }> = [];
        const frameElements = document.querySelectorAll("frame");

        for (const frame of frameElements) {
          const src = frame.getAttribute("src");
          if (src?.trim() && !src.startsWith("javascript:") && src !== "about:blank") {
            const name = frame.getAttribute("name") || undefined;
            frames.push({ src: src.trim(), name });
          }
        }

        return frames;
      });
    } catch (error) {
      logger.debug(`Error extracting frame URLs: ${error}`);
      return [];
    }
  }

  /**
   * Sets up caching route interception for a Playwright page.
   * This handles:
   * - Aborting non-essential resources (images, fonts, media)
   * - Caching GET requests to speed up subsequent loads
   * - Forwarding custom headers and credentials for same-origin requests
   *
   * @param page The Playwright page to set up routing for
   * @param customHeaders Custom headers to forward with requests
   * @param credentials Optional credentials for same-origin requests
   * @param origin The origin for same-origin credential checking
   */
  /**
   * Checks if an error is a Playwright "Route is already handled" error.
   * This specific error occurs when multiple handlers attempt to handle the same route.
   */
  private isRouteAlreadyHandledError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.message.includes("Route is already handled");
    }
    return false;
  }

  private async setupCachingRouteInterception(
    page: Page,
    customHeaders: Record<string, string> = {},
    credentials?: { username: string; password: string },
    origin?: string,
  ): Promise<void> {
    await page.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      const reqOrigin = (() => {
        try {
          return new URL(reqUrl).origin;
        } catch {
          return null;
        }
      })();
      const resourceType = route.request().resourceType();

      // Abort non-essential resources
      if (["image", "font", "media"].includes(resourceType)) {
        try {
          return await route.abort();
        } catch (error) {
          if (this.isRouteAlreadyHandledError(error)) {
            logger.debug(`Route already handled (abort): ${reqUrl}`);
            return;
          }
          // Re-throw other errors (page closed, invalid state, etc.)
          throw error;
        }
      }

      // Cache all GET requests to speed up subsequent page loads
      if (route.request().method() === "GET") {
        // Check cache first
        const cached = HtmlPlaywrightMiddleware.resourceCache.get(reqUrl);
        if (cached !== undefined) {
          logger.debug(`✓ Cache hit for ${resourceType}: ${reqUrl}`);
          try {
            return await route.fulfill({
              status: 200,
              contentType: cached.contentType,
              body: cached.body,
            });
          } catch (error) {
            if (this.isRouteAlreadyHandledError(error)) {
              logger.debug(`Route already handled (fulfill cached): ${reqUrl}`);
              return;
            }
            // Re-throw other errors (bad response/options, closed page, etc.)
            throw error;
          }
        }

        // Cache miss - fetch and potentially cache the response
        const headers = mergePlaywrightHeaders(
          route.request().headers(),
          customHeaders,
          credentials,
          origin,
          reqOrigin ?? undefined,
        );

        try {
          const response = await route.fetch({ headers });
          const body = await response.text();

          // Only cache if content is small enough and response was successful (2xx status)
          if (response.status() >= 200 && response.status() < 300 && body.length > 0) {
            const contentSizeBytes = Buffer.byteLength(body, "utf8");
            if (contentSizeBytes <= this.config.fetcher.maxCacheItemSizeBytes) {
              const contentType =
                response.headers()["content-type"] || "application/octet-stream";
              HtmlPlaywrightMiddleware.resourceCache.set(reqUrl, { body, contentType });
              logger.debug(
                `Cached ${resourceType}: ${reqUrl} (${contentSizeBytes} bytes, cache size: ${HtmlPlaywrightMiddleware.resourceCache.size})`,
              );
            } else {
              logger.debug(
                `Resource too large to cache: ${reqUrl} (${contentSizeBytes} bytes > ${this.config.fetcher.maxCacheItemSizeBytes} bytes limit)`,
              );
            }
          }

          try {
            return await route.fulfill({ response });
          } catch (error) {
            if (this.isRouteAlreadyHandledError(error)) {
              logger.debug(`Route already handled (fulfill): ${reqUrl}`);
              return;
            }
            // Re-throw other errors (bad response/options, closed page, etc.)
            throw error;
          }
        } catch (error) {
          // Handle network errors (DNS, connection refused, timeout, etc.)
          // Treat these as failed resource requests - abort gracefully
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.debug(
            `Network error fetching ${resourceType} ${reqUrl}: ${errorMessage}`,
          );
          try {
            return await route.abort("failed");
          } catch (abortError) {
            if (this.isRouteAlreadyHandledError(abortError)) {
              logger.debug(`Route already handled (abort after error): ${reqUrl}`);
              return;
            }
            // Re-throw other errors
            throw abortError;
          }
        }
      }

      // Non-GET requests: just forward with headers
      const headers = mergePlaywrightHeaders(
        route.request().headers(),
        customHeaders,
        credentials,
        origin,
        reqOrigin ?? undefined,
      );

      try {
        return await route.continue({ headers });
      } catch (error) {
        // If route was already handled, return silently
        if (this.isRouteAlreadyHandledError(error)) {
          logger.debug(`Route already handled (continue): ${reqUrl}`);
          return;
        }

        // For other errors (network issues, closed page, etc.), try to abort
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.debug(`Error continuing ${resourceType} ${reqUrl}: ${errorMessage}`);
        try {
          return await route.abort("failed");
        } catch (abortError) {
          if (this.isRouteAlreadyHandledError(abortError)) {
            logger.debug(`Route already handled (abort after continue error): ${reqUrl}`);
            return;
          }
          // Re-throw other errors
          throw abortError;
        }
      }
    });
  }

  /**
   * Fetches content from a frame URL by navigating to it in a new page.
   * Uses LRU cache to avoid re-fetching identical frames across multiple pages.
   *
   * @param parentPage The parent page (used to resolve relative URLs and share context)
   * @param frameUrl The URL of the frame to fetch content from
   * @returns The HTML content of the frame
   */
  private async fetchFrameContent(parentPage: Page, frameUrl: string): Promise<string> {
    // Resolve relative URLs against the parent page URL
    const resolvedUrl = new URL(frameUrl, parentPage.url()).href;

    // Check cache first
    const cached = HtmlPlaywrightMiddleware.resourceCache.get(resolvedUrl);
    if (cached !== undefined) {
      logger.debug(`✓ Cache hit for frame: ${resolvedUrl}`);
      return cached.body;
    }

    logger.debug(`Cache miss for frame: ${resolvedUrl}`);

    let framePage: Page | null = null;
    try {
      // Create a new page in the same browser context for consistency
      framePage = await parentPage.context().newPage();

      // Set up the same caching route interception as the parent page
      await this.setupCachingRouteInterception(framePage);

      logger.debug(`Fetching frame content from: ${resolvedUrl}`);

      // Navigate to the frame URL
      await framePage.goto(resolvedUrl, {
        waitUntil: "load",
        timeout: this.config.pageTimeoutMs,
      });
      await framePage.waitForSelector("body", {
        timeout: this.config.pageTimeoutMs,
      });

      // Wait for loading indicators to complete
      await this.waitForLoadingToComplete(framePage);

      // Extract the body content (not full HTML to avoid conflicts)
      const bodyContent = await framePage.$eval(
        "body",
        (el: HTMLElement) => el.innerHTML,
      );

      const content = bodyContent || "";

      // Only cache if content is small enough (avoid caching large content pages)
      const contentSizeBytes = Buffer.byteLength(content, "utf8");
      if (contentSizeBytes <= this.config.fetcher.maxCacheItemSizeBytes) {
        // Frame content is always HTML
        HtmlPlaywrightMiddleware.resourceCache.set(resolvedUrl, {
          body: content,
          contentType: "text/html",
        });
        logger.debug(
          `Cached frame content: ${resolvedUrl} (${contentSizeBytes} bytes, cache size: ${HtmlPlaywrightMiddleware.resourceCache.size})`,
        );
      } else {
        logger.debug(
          `Frame content too large to cache: ${resolvedUrl} (${contentSizeBytes} bytes > ${this.config.fetcher.maxCacheItemSizeBytes} bytes limit)`,
        );
      }

      logger.debug(`Successfully fetched frame content from: ${resolvedUrl}`);
      return content;
    } catch (error) {
      logger.debug(`Error fetching frame content from ${frameUrl}: ${error}`);
      return "";
    } finally {
      if (framePage) {
        await framePage.unroute("**/*");
        await framePage.close();
      }
    }
  }

  /**
   * Merges frame contents and replaces the frameset structure with the merged content.
   *
   * @param page The main page containing the frameset
   * @param frameContents Array of frame content objects with URL, content, and optional name
   */
  private async mergeFrameContents(
    page: Page,
    frameContents: Array<{ url: string; content: string; name?: string }>,
  ): Promise<void> {
    try {
      // Build merged content sequentially, preserving frameset definition order
      const mergedContent = frameContents
        .map((frame, index) => {
          const frameName = frame.name ? ` (${frame.name})` : "";
          const frameHeader = `<!-- Frame ${index + 1}${frameName}: ${frame.url} -->`;
          return `${frameHeader}\n<div data-frame-url="${frame.url}" data-frame-name="${frame.name || ""}">\n${frame.content}\n</div>`;
        })
        .join("\n\n");

      // Replace the entire frameset structure with merged content
      await page.evaluate((mergedHtml: string) => {
        // Find all framesets and replace them with the merged content
        const framesets = document.querySelectorAll("frameset");
        if (framesets.length > 0) {
          // Create a body element with the merged content
          const body = document.createElement("body");
          body.innerHTML = mergedHtml;

          // Replace the first frameset with our body element
          // (typically there's only one root frameset)
          const firstFrameset = framesets[0];
          if (firstFrameset.parentNode) {
            firstFrameset.parentNode.replaceChild(body, firstFrameset);
          }

          // Remove any remaining framesets
          for (let i = 1; i < framesets.length; i++) {
            const frameset = framesets[i];
            if (frameset.parentNode) {
              frameset.parentNode.removeChild(frameset);
            }
          }
        }
      }, mergedContent);

      logger.debug("Successfully replaced frameset with merged content");
    } catch (error) {
      logger.debug(`Error merging frame contents: ${error}`);
    }
  }

  /**
   * Processes the context using Playwright, rendering dynamic content and propagating credentials for all same-origin requests.
   *
   * - Parses credentials from the URL (if present).
   * - Uses browser.newContext({ httpCredentials }) for HTTP Basic Auth on the main page and subresources.
   * - Injects Authorization header for all same-origin requests if credentials are present and not already set.
   * - Forwards all custom headers from context.options?.headers to Playwright requests.
   * - Waits for common loading indicators to disappear before extracting HTML.
   *
   * @param context The middleware context containing the HTML and source URL.
   * @param next The next middleware function in the pipeline.
   */
  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    // Check if we have a MIME type from the raw content and if it's suitable for HTML processing
    const contentType = context.options?.headers?.["content-type"] || context.contentType;

    // Safety check: If we detect this is definitely not HTML content, skip Playwright
    if (
      contentType &&
      typeof contentType === "string" &&
      !MimeTypeUtils.isHtml(contentType)
    ) {
      logger.debug(
        `Skipping Playwright rendering for ${context.source} - content type '${contentType}' is not HTML`,
      );
      await next();
      return;
    }

    // Determine if Playwright should run based on scrapeMode
    const scrapeMode = context.options?.scrapeMode ?? ScrapeMode.Auto;
    const shouldRunPlaywright =
      scrapeMode === ScrapeMode.Playwright || scrapeMode === ScrapeMode.Auto;

    if (!shouldRunPlaywright) {
      // Handle gracefully although the middleware shouldn't even be in the pipeline
      logger.debug(
        `Skipping Playwright rendering for ${context.source} as scrapeMode is '${scrapeMode}'.`,
      );
      await next();
      return;
    }

    logger.debug(
      `Running Playwright rendering for ${context.source} (scrapeMode: '${scrapeMode}')`,
    );

    let page: Page | null = null;
    let browserContext: BrowserContext | null = null;
    let renderedHtml: string | null = null;

    // Extract credentials and origin using helper
    const { credentials, origin } = extractCredentialsAndOrigin(context.source);

    // Extract custom headers (Record<string, string>)
    const customHeaders: Record<string, string> = context.options?.headers ?? {};

    try {
      const browser = await this.ensureBrowser();

      // Always create a browser context (with or without credentials)
      if (credentials) {
        browserContext = await browser.newContext({ httpCredentials: credentials });
      } else {
        browserContext = await browser.newContext();
      }
      page = await browserContext.newPage();

      logger.debug(`Playwright: Processing ${context.source}`);

      // Inject shadow DOM extractor script early
      await this.injectShadowDOMExtractor(page);

      // Set up route interception with special handling for the initial page load
      await page.route("**/*", async (route) => {
        const reqUrl = route.request().url();

        // Serve the initial HTML for the main page (bypass cache and fetch)
        if (reqUrl === context.source) {
          try {
            return await route.fulfill({
              status: 200,
              contentType: "text/html; charset=utf-8",
              body: context.content,
            });
          } catch (error) {
            if (this.isRouteAlreadyHandledError(error)) {
              logger.debug(`Route already handled (initial page): ${reqUrl}`);
              return;
            }
            // Re-throw other errors
            throw error;
          }
        }

        // For all other requests, use the standard caching logic
        // We need to manually handle the interception since we can't delegate to another route
        const reqOrigin = (() => {
          try {
            return new URL(reqUrl).origin;
          } catch {
            return null;
          }
        })();
        const resourceType = route.request().resourceType();

        // Abort non-essential resources
        if (["image", "font", "media"].includes(resourceType)) {
          try {
            return await route.abort();
          } catch (error) {
            if (this.isRouteAlreadyHandledError(error)) {
              logger.debug(`Route already handled (abort): ${reqUrl}`);
              return;
            }
            // Re-throw other errors
            throw error;
          }
        }

        // Cache all GET requests to speed up subsequent page loads
        if (route.request().method() === "GET") {
          // Check cache first
          const cached = HtmlPlaywrightMiddleware.resourceCache.get(reqUrl);
          if (cached !== undefined) {
            logger.debug(`✓ Cache hit for ${resourceType}: ${reqUrl}`);
            try {
              return await route.fulfill({
                status: 200,
                contentType: cached.contentType,
                body: cached.body,
              });
            } catch (error) {
              if (this.isRouteAlreadyHandledError(error)) {
                logger.debug(`Route already handled (fulfill cached): ${reqUrl}`);
                return;
              }
              // Re-throw other errors
              throw error;
            }
          }

          // Cache miss - fetch and potentially cache the response
          const headers = mergePlaywrightHeaders(
            route.request().headers(),
            customHeaders,
            credentials ?? undefined,
            origin ?? undefined,
            reqOrigin ?? undefined,
          );

          try {
            const response = await route.fetch({ headers });
            const body = await response.text();

            // Only cache if content is small enough and response was successful (2xx status)
            if (response.status() >= 200 && response.status() < 300 && body.length > 0) {
              const contentSizeBytes = Buffer.byteLength(body, "utf8");
              const maxCacheItemSizeBytes =
                this.config?.fetcher?.maxCacheItemSizeBytes ??
                defaults.scraper.fetcher.maxCacheItemSizeBytes;
              if (contentSizeBytes <= maxCacheItemSizeBytes) {
                const contentType =
                  response.headers()["content-type"] || "application/octet-stream";
                HtmlPlaywrightMiddleware.resourceCache.set(reqUrl, { body, contentType });
                logger.debug(
                  `Cached ${resourceType}: ${reqUrl} (${contentSizeBytes} bytes, cache size: ${HtmlPlaywrightMiddleware.resourceCache.size})`,
                );
              } else {
                logger.debug(
                  `Resource too large to cache: ${reqUrl} (${contentSizeBytes} bytes > ${maxCacheItemSizeBytes} bytes limit)`,
                );
              }
            }

            try {
              return await route.fulfill({ response });
            } catch (error) {
              if (this.isRouteAlreadyHandledError(error)) {
                logger.debug(`Route already handled (fulfill): ${reqUrl}`);
                return;
              }
              // Re-throw other errors
              throw error;
            }
          } catch (error) {
            // Handle network errors (DNS, connection refused, timeout, etc.)
            // Treat these as failed resource requests - abort gracefully
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug(
              `Network error fetching ${resourceType} ${reqUrl}: ${errorMessage}`,
            );
            try {
              return await route.abort("failed");
            } catch (abortError) {
              if (this.isRouteAlreadyHandledError(abortError)) {
                logger.debug(`Route already handled (abort after error): ${reqUrl}`);
                return;
              }
              // Re-throw other errors
              throw abortError;
            }
          }
        }

        // Non-GET requests: just forward with headers
        const headers = mergePlaywrightHeaders(
          route.request().headers(),
          customHeaders,
          credentials ?? undefined,
          origin ?? undefined,
          reqOrigin ?? undefined,
        );

        try {
          return await route.continue({ headers });
        } catch (error) {
          // If route was already handled, return silently
          if (this.isRouteAlreadyHandledError(error)) {
            logger.debug(`Route already handled (continue): ${reqUrl}`);
            return;
          }

          // For other errors (network issues, closed page, etc.), try to abort
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.debug(`Error continuing ${resourceType} ${reqUrl}: ${errorMessage}`);
          try {
            return await route.abort("failed");
          } catch (abortError) {
            if (this.isRouteAlreadyHandledError(abortError)) {
              logger.debug(
                `Route already handled (abort after continue error): ${reqUrl}`,
              );
              return;
            }
            // Re-throw other errors
            throw abortError;
          }
        }
      });

      // Load initial HTML content
      await page.goto(context.source, { waitUntil: "load" });

      // Wait for either body (normal HTML) or frameset (frameset documents) to appear
      const pageTimeoutMs = this.config.pageTimeoutMs ?? defaults.scraper.pageTimeoutMs;
      await page.waitForSelector("body, frameset", {
        timeout: pageTimeoutMs,
      });

      // Wait for network idle to let dynamic content initialize
      try {
        await page.waitForLoadState("networkidle", {
          timeout: pageTimeoutMs,
        });
      } catch {
        logger.debug("Network idle timeout, proceeding anyway");
      }

      await this.waitForLoadingToComplete(page);
      await this.waitForIframesToLoad(page);
      await this.waitForFramesetsToLoad(page);

      // Extract content using shadow DOM-aware method
      const { content, method } = await this.extractContentWithShadowDOMSupport(page);
      renderedHtml = content;
      logger.debug(
        `Playwright: Successfully rendered content for ${context.source} using ${method}`,
      );
    } catch (error) {
      logger.error(`❌ Playwright failed to render ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`Playwright rendering failed: ${String(error)}`),
      );
    } finally {
      // Ensure page/context are closed even if subsequent steps fail
      if (page) {
        await page.unroute("**/*");
        await page.close();
      }
      if (browserContext) {
        await browserContext.close();
      }
    }

    if (renderedHtml !== null) {
      context.content = renderedHtml;
      logger.debug(
        `Playwright middleware updated content for ${context.source}. Proceeding.`,
      );
    } else {
      logger.warn(
        `⚠️  Playwright rendering resulted in null content for ${context.source}. Proceeding without content update.`,
      );
    }

    await next();
  }

  /**
   * Safely combines original page content with shadow DOM content outside the browser context.
   * This avoids triggering any anti-scraping detection mechanisms.
   */
  private combineContentSafely(
    originalContent: string,
    shadowMappings: ShadowMapping[],
  ): string {
    let combinedContent = originalContent;

    // Add shadow content at the end of the body to avoid breaking the document structure
    const bodyCloseIndex = combinedContent.lastIndexOf("</body>");
    if (bodyCloseIndex !== -1) {
      let shadowContentHTML = "\n<!-- SHADOW DOM CONTENT EXTRACTED SAFELY -->\n";

      // Sort by content length (largest first) to prioritize important content
      const sortedMappings = shadowMappings.sort(
        (a, b) => b.shadowContent.length - a.shadowContent.length,
      );

      sortedMappings.forEach((mapping) => {
        shadowContentHTML += `\n<!-- SHADOW CONTENT: ${mapping.hostTagName} (${mapping.shadowContent.length} chars) -->\n`;
        shadowContentHTML += mapping.shadowContent;
        shadowContentHTML += `\n<!-- END SHADOW CONTENT: ${mapping.hostTagName} -->\n`;
      });

      shadowContentHTML += "\n<!-- END ALL SHADOW DOM CONTENT -->\n";

      // Insert before closing body tag
      combinedContent =
        combinedContent.slice(0, bodyCloseIndex) +
        shadowContentHTML +
        combinedContent.slice(bodyCloseIndex);
    }

    return combinedContent;
  }
}

/**
 * Extracts credentials and origin from a URL string.
 * Returns { credentials, origin } where credentials is null if not present.
 */
export function extractCredentialsAndOrigin(urlString: string): {
  credentials: { username: string; password: string } | null;
  origin: string | null;
} {
  try {
    const url = new URL(urlString);
    const origin = url.origin;
    if (url.username && url.password) {
      return {
        credentials: { username: url.username, password: url.password },
        origin,
      };
    }
    return { credentials: null, origin };
  } catch {
    return { credentials: null, origin: null };
  }
}

/**
 * Merges Playwright request headers, custom headers, and credentials.
 * - Custom headers are merged in unless already present (except Authorization, see below).
 * - If credentials are present and the request is same-origin, injects Authorization if not already set.
 */
export function mergePlaywrightHeaders(
  requestHeaders: Record<string, string>,
  customHeaders: Record<string, string>,
  credentials?: { username: string; password: string },
  origin?: string,
  reqOrigin?: string,
): Record<string, string> {
  let headers = { ...requestHeaders };
  for (const [key, value] of Object.entries(customHeaders)) {
    if (key.toLowerCase() === "authorization" && headers.authorization) continue;
    headers[key] = value;
  }
  if (credentials && origin && reqOrigin === origin && !headers.authorization) {
    const basic = Buffer.from(`${credentials.username}:${credentials.password}`).toString(
      "base64",
    );
    headers = {
      ...headers,
      Authorization: `Basic ${basic}`,
    };
  }
  return headers;
}
