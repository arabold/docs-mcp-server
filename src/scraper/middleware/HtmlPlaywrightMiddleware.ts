import { type Browser, type BrowserContext, type Page, chromium } from "playwright";
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
   * Waits for common loading indicators (spinners, loaders) that are currently visible to disappear from the page.
   * Only waits for selectors that are present and visible at the time of check.
   *
   * @param page The Playwright page instance to operate on.
   */
  private async waitForLoadingToComplete(page: Page): Promise<void> {
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
        const isVisible = await page.isVisible(selector).catch(() => false);
        if (isVisible) {
          waitPromises.push(
            page
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
   * Processes the context using Playwright, rendering dynamic content and propagating credentials for all same-origin requests.
   *
   * - Parses credentials from the URL (if present).
   * - Uses browser.newContext({ httpCredentials }) for HTTP Basic Auth on the main page and subresources.
   * - Injects Authorization header for all same-origin requests if credentials are present and not already set.
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

    // --- Credential Extraction ---
    let credentials: { username: string; password: string } | null = null;
    let origin: string | null = null;
    try {
      const url = new URL(context.source);
      origin = url.origin;
      if (url.username && url.password) {
        credentials = { username: url.username, password: url.password };
        logger.debug(
          `Playwright: Detected credentials for ${origin} (username: ${url.username})`,
        );
      }
    } catch (e) {
      logger.warn(`⚠️  Could not parse URL for credential extraction: ${context.source}`);
    }

    try {
      const browser = await this.ensureBrowser();
      if (credentials) {
        browserContext = await browser.newContext({ httpCredentials: credentials });
        page = await browserContext.newPage();
      } else {
        page = await browser.newPage();
      }
      logger.debug(`Playwright: Processing ${context.source}`);

      // Block unnecessary resources and inject credentials for same-origin requests
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
            contentType: "text/html",
            body: context.content,
          });
        }
        // Abort non-essential resources
        const resourceType = route.request().resourceType();
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          return route.abort();
        }
        // Inject Authorization header for same-origin requests if credentials are present
        if (
          credentials &&
          origin &&
          reqOrigin === origin &&
          !route.request().headers().authorization
        ) {
          const basic = Buffer.from(
            `${credentials.username}:${credentials.password}`,
          ).toString("base64");
          const headers = {
            ...route.request().headers(),
            Authorization: `Basic ${basic}`,
          };
          return route.continue({ headers });
        }
        return route.continue();
      });

      // Load initial HTML content
      await page.goto(context.source, { waitUntil: "load" });
      await page.waitForSelector("body");
      await this.waitForLoadingToComplete(page);
      // await page.waitForLoadState("networkidle");

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
