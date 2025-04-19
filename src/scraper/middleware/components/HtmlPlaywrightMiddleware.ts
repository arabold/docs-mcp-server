import { JSDOM } from "jsdom";
import { type Browser, type Page, chromium } from "playwright";
import { logger } from "../../../utils/logger";
import type { ContentProcessingContext, ContentProcessorMiddleware } from "../types";

/**
 * Middleware to process HTML content using Playwright for rendering dynamic content,
 * then parse the result with JSDOM for subsequent processing.
 * It updates `context.content` with the rendered HTML and `context.dom`.
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
      logger.debug(
        `Launching new Playwright browser instance (Chromium) with args: ${launchArgs.join(" ") || "none"}...`,
      );
      this.browser = await chromium.launch({ channel: "chromium", args: launchArgs });
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

  async process(
    context: ContentProcessingContext,
    next: () => Promise<void>,
  ): Promise<void> {
    // Only process HTML content
    if (!context.contentType.startsWith("text/html")) {
      await next();
      return;
    }

    // Ensure content is a string
    const initialHtmlString =
      typeof context.content === "string"
        ? context.content
        : Buffer.from(context.content).toString("utf-8");

    let page: Page | null = null;
    let renderedHtml: string | null = null;

    try {
      const browser = await this.ensureBrowser();
      page = await browser.newPage();
      logger.debug(`Playwright: Processing ${context.source}`);

      // Block unnecessary resources
      await page.route("**/*", (route) => {
        const resourceType = route.request().resourceType();
        if (route.request().url() === context.source) {
          return route.fulfill({
            status: 200,
            contentType: context.contentType,
            body: initialHtmlString,
          });
        }
        if (["image", "stylesheet", "font", "media"].includes(resourceType)) {
          return route.abort();
        }
        return route.continue();
      });

      // Load initial HTML content
      // Use 'domcontentloaded' as scripts might need the initial DOM structure
      // Use 'networkidle' if waiting for async data fetches is critical, but slower.
      await page.goto(context.source, {
        waitUntil: "domcontentloaded",
      });

      // Optionally, add a small delay or wait for a specific element if needed
      // await page.waitForTimeout(100); // Example: wait 100ms

      // Get the fully rendered HTML
      renderedHtml = await page.content();
      logger.debug(`Playwright: Successfully rendered content for ${context.source}`);
    } catch (error) {
      logger.error(`Playwright failed to render ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`Playwright rendering failed: ${String(error)}`),
      );
    } finally {
      // Ensure page is closed even if subsequent steps fail
      if (page) await page.close();
    }

    // If rendering succeeded, update context and parse with JSDOM
    if (renderedHtml !== null) {
      context.content = renderedHtml; // Update content with rendered HTML

      try {
        logger.debug(`Parsing Playwright-rendered HTML with JSDOM for ${context.source}`);
        const domWindow = new JSDOM(renderedHtml, {
          url: context.source, // Provide the source URL to JSDOM
        }).window;

        // Update the DOM in the context for subsequent middleware
        context.dom = domWindow;

        // Proceed to the next middleware
        await next();
      } catch (error) {
        logger.error(
          `Failed to parse Playwright-rendered HTML with JSDOM for ${context.source}: ${error}`,
        );
        context.errors.push(
          error instanceof Error
            ? error
            : new Error(`JSDOM parsing failed after Playwright: ${String(error)}`),
        );
        // Stop processing if JSDOM parsing fails
        return;
      }
    } else {
      // This case should ideally not be reached if error handling is correct
      logger.warn(
        `Playwright rendering resulted in null content for ${context.source}, skipping JSDOM parsing.`,
      );
      await next(); // Or decide to stop pipeline?
    }
  }
}
