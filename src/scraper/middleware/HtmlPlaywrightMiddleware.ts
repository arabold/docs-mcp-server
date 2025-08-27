import {
  type Browser,
  type BrowserContext,
  chromium,
  type ElementHandle,
  type Frame,
  type Page,
} from "playwright";
import { DEFAULT_PAGE_TIMEOUT } from "../../utils/config";
import { logger } from "../../utils/logger";
import { ScrapeMode } from "../types";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

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

  /**
   * Initializes the Playwright browser instance.
   * Consider making this more robust (e.g., lazy initialization, singleton).
   */
  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      const launchArgs = process.env.PLAYWRIGHT_LAUNCH_ARGS?.split(" ") ?? [];
      const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
      logger.debug(
        `Launching new Playwright browser instance (Chromium) with args: ${launchArgs.join(" ") || "none"}...`,
      );
      this.browser = await chromium.launch({
        channel: "chromium",
        args: launchArgs,
        executablePath: executablePath,
      });
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
   */
  async closeBrowser(): Promise<void> {
    if (this.browser?.isConnected()) {
      logger.debug("Closing Playwright browser instance...");
      await this.browser.close();
      this.browser = null;
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
                timeout: DEFAULT_PAGE_TIMEOUT,
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

      // Wait for the iframe body to load
      await frame.waitForSelector("body", { timeout: DEFAULT_PAGE_TIMEOUT }).catch(() => {
        logger.debug(`Timeout waiting for body in iframe ${index + 1}`);
      });

      // Wait for loading indicators in the iframe to complete
      await this.waitForLoadingToComplete(frame);

      // Extract and replace iframe content
      const content = await this.extractIframeContent(frame);
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
      logger.debug(`Error waiting for iframe ${index + 1}: ${error}`);
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
   * Fetches content from a frame URL by navigating to it in a new page.
   *
   * @param parentPage The parent page (used to resolve relative URLs and share context)
   * @param frameUrl The URL of the frame to fetch content from
   * @returns The HTML content of the frame
   */
  private async fetchFrameContent(parentPage: Page, frameUrl: string): Promise<string> {
    let framePage: Page | null = null;
    try {
      // Resolve relative URLs against the parent page URL
      const resolvedUrl = new URL(frameUrl, parentPage.url()).href;

      // Create a new page in the same browser context for consistency
      framePage = await parentPage.context().newPage();

      // Use the same route handling as the parent page for consistency
      await framePage.route("**/*", async (route) => {
        const resourceType = route.request().resourceType();

        // Abort non-essential resources (but keep stylesheets for content rendering)
        if (["image", "font", "media"].includes(resourceType)) {
          return route.abort();
        }

        return route.continue();
      });

      logger.debug(`Fetching frame content from: ${resolvedUrl}`);

      // Navigate to the frame URL
      await framePage.goto(resolvedUrl, { waitUntil: "load", timeout: 15000 });
      await framePage.waitForSelector("body", { timeout: 10000 });

      // Wait for loading indicators to complete
      await this.waitForLoadingToComplete(framePage);

      // Extract the body content (not full HTML to avoid conflicts)
      const bodyContent = await framePage.$eval(
        "body",
        (el: HTMLElement) => el.innerHTML,
      );

      logger.debug(`Successfully fetched frame content from: ${resolvedUrl}`);
      return bodyContent || "";
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
    // Always process, content type is handled by pipeline selection

    // Determine if Playwright should run based on scrapeMode
    const scrapeMode = context.options?.scrapeMode ?? ScrapeMode.Auto;
    const shouldRunPlaywright =
      scrapeMode === ScrapeMode.Playwright || scrapeMode === ScrapeMode.Auto;

    if (!shouldRunPlaywright) {
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

      // Block unnecessary resources and inject credentials and custom headers for same-origin requests
      await page.route("**/*", async (route) => {
        const reqUrl = route.request().url();
        const reqOrigin = (() => {
          try {
            return new URL(reqUrl).origin;
          } catch {
            return null;
          }
        })();
        // Serve the initial HTML for the main page
        if (reqUrl === context.source) {
          return route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: context.content, // context.content is always a string in middleware
          });
        }
        // Abort non-essential resources (but keep stylesheets for modern web apps)
        const resourceType = route.request().resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          return route.abort();
        }
        // Use helper to merge headers
        const headers = mergePlaywrightHeaders(
          route.request().headers(),
          customHeaders,
          credentials ?? undefined,
          origin ?? undefined,
          reqOrigin ?? undefined,
        );
        return route.continue({ headers });
      });

      // Load initial HTML content
      await page.goto(context.source, { waitUntil: "load" });

      // Wait for either body (normal HTML) or frameset (frameset documents) to appear
      await page.waitForSelector("body, frameset");

      // Wait for network idle to let dynamic content initialize
      try {
        await page.waitForLoadState("networkidle", { timeout: DEFAULT_PAGE_TIMEOUT });
      } catch {
        logger.debug("Network idle timeout, proceeding anyway");
      }

      await this.waitForLoadingToComplete(page);
      await this.waitForIframesToLoad(page);
      await this.waitForFramesetsToLoad(page);

      renderedHtml = await page.content();
      logger.debug(`Playwright: Successfully rendered content for ${context.source}`);
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
