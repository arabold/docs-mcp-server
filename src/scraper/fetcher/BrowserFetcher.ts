import { type Browser, chromium, type Page } from "playwright";
import { ScraperAccessPolicy } from "../../utils/accessPolicy";
import type { AppConfig } from "../../utils/config";
import { ScraperError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { FingerprintGenerator } from "./FingerprintGenerator";
import {
  type ContentFetcher,
  type FetchOptions,
  FetchStatus,
  type RawContent,
} from "./types";

/**
 * Fetches content using a headless browser (Playwright).
 * This fetcher can handle JavaScript-heavy pages and bypass anti-scraping measures.
 */
export class BrowserFetcher implements ContentFetcher {
  private browser: Browser | null = null;
  private fingerprintGenerator: FingerprintGenerator;
  private readonly defaultTimeoutMs: number;
  private readonly accessPolicy: ScraperAccessPolicy;

  constructor(scraperConfig: AppConfig["scraper"]) {
    this.defaultTimeoutMs = scraperConfig.browserTimeoutMs;
    this.fingerprintGenerator = new FingerprintGenerator();
    this.accessPolicy = new ScraperAccessPolicy(scraperConfig.security);
  }

  canFetch(source: string): boolean {
    return source.startsWith("http://") || source.startsWith("https://");
  }

  private async isRequestAllowed(url: string): Promise<boolean> {
    try {
      await this.accessPolicy.assertNetworkUrlAllowed(url);
      return true;
    } catch {
      return false;
    }
  }

  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    let page: Page | null = null;
    let browserContext: { newPage(): Promise<Page>; close(): Promise<void> } | null =
      null;

    try {
      await this.accessPolicy.assertNetworkUrlAllowed(source);

      const browser = await this.ensureBrowserReady();
      const fingerprintHeaders = this.fingerprintGenerator.generateHeaders();
      browserContext = await browser.newContext({
        ignoreHTTPSErrors: this.accessPolicy.shouldAllowInvalidTls(
          "https://browser-context.local",
        ),
      });
      page = await browserContext.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        if (!(await this.isRequestAllowed(requestUrl))) {
          return await route.abort("blockedbyclient");
        }

        return await route.continue();
      });

      // Set custom headers if provided
      await page.setExtraHTTPHeaders({
        ...fingerprintHeaders,
        ...options?.headers,
      });

      // Set timeout
      const timeout = options?.timeout || this.defaultTimeoutMs;

      // Navigate to the page and wait for it to load
      logger.debug(`Navigating to ${source} with browser...`);
      const response = await page.goto(source, {
        waitUntil: "networkidle",
        timeout,
      });

      if (!response) {
        throw new ScraperError(`Failed to navigate to ${source}`, false);
      }

      // Check if we should follow redirects
      if (
        options?.followRedirects === false &&
        response.status() >= 300 &&
        response.status() < 400
      ) {
        const location = response.headers().location;
        if (location) {
          throw new ScraperError(`Redirect blocked: ${source} -> ${location}`, false);
        }
      }

      // Get the final URL after any redirects
      const finalUrl = page.url();
      await this.accessPolicy.assertNetworkUrlAllowed(finalUrl);

      // Get the page content
      const content = await page.content();
      const contentBuffer = Buffer.from(content, "utf-8");

      // Determine content type
      const contentType = response.headers()["content-type"] || "text/html";
      const { mimeType, charset } = MimeTypeUtils.parseContentType(contentType);

      // Extract ETag header for caching
      const etag = response.headers().etag;

      return {
        content: contentBuffer,
        mimeType,
        charset,
        encoding: undefined, // Browser handles encoding automatically
        source: finalUrl,
        etag,
        status: FetchStatus.SUCCESS,
      } satisfies RawContent;
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new ScraperError("Browser fetch cancelled", false);
      }

      logger.error(`❌ Browser fetch failed for ${source}: ${error}`);
      throw new ScraperError(
        `Browser fetch failed for ${source}: ${error instanceof Error ? error.message : String(error)}`,
        false,
        error instanceof Error ? error : undefined,
      );
    } finally {
      await page?.unroute("**/*").catch(() => undefined);
      await page?.close().catch(() => undefined);
      await browserContext?.close().catch(() => undefined);
    }
  }

  public static async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox"],
    });
  }

  private async ensureBrowserReady(): Promise<Browser> {
    if (!this.browser) {
      logger.debug("Launching browser...");
      this.browser = await BrowserFetcher.launchBrowser();
    }

    return this.browser;
  }

  /**
   * Close the browser and clean up resources.
   * Always attempts cleanup even if browser is disconnected to reap zombie processes.
   */
  async close(): Promise<void> {
    // Close page first
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        logger.warn(`⚠️  Error closing browser: ${error}`);
      } finally {
        this.browser = null;
      }
    }

    logger.debug("Browser closed successfully");
  }
}
