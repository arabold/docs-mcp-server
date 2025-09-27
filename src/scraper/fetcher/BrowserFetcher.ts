import { type Browser, chromium, type Page } from "playwright";
import { ScraperError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { FingerprintGenerator } from "./FingerprintGenerator";
import type { ContentFetcher, FetchOptions, RawContent } from "./types";

/**
 * Fetches content using a headless browser (Playwright).
 * This fetcher can handle JavaScript-heavy pages and bypass anti-scraping measures.
 */
export class BrowserFetcher implements ContentFetcher {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private fingerprintGenerator: FingerprintGenerator;

  constructor() {
    this.fingerprintGenerator = new FingerprintGenerator();
  }

  canFetch(source: string): boolean {
    return source.startsWith("http://") || source.startsWith("https://");
  }

  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    try {
      await this.ensureBrowserReady();

      if (!this.page) {
        throw new ScraperError("Failed to create browser page", false);
      }

      // Set custom headers if provided
      if (options?.headers) {
        await this.page.setExtraHTTPHeaders(options.headers);
      }

      // Set timeout
      const timeout = options?.timeout || 30000;

      // Navigate to the page and wait for it to load
      logger.debug(`🌐 Navigating to ${source} with browser...`);
      const response = await this.page.goto(source, {
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
      const finalUrl = this.page.url();

      // Get the page content
      const content = await this.page.content();
      const contentBuffer = Buffer.from(content, "utf-8");

      // Determine content type
      const contentType = response.headers()["content-type"] || "text/html";
      const { mimeType, charset } = MimeTypeUtils.parseContentType(contentType);

      return {
        content: contentBuffer,
        mimeType,
        charset,
        encoding: undefined, // Browser handles encoding automatically
        source: finalUrl,
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
    }
  }

  private async ensureBrowserReady(): Promise<void> {
    if (!this.browser) {
      logger.debug("🚀 Launching browser...");
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-web-security",
          "--disable-features=site-per-process",
        ],
      });
    }

    if (!this.page) {
      this.page = await this.browser.newPage();

      // Generate and set realistic browser headers
      const dynamicHeaders = this.fingerprintGenerator.generateHeaders();
      await this.page.setExtraHTTPHeaders(dynamicHeaders);

      // Set viewport
      await this.page.setViewportSize({ width: 1920, height: 1080 });
    }
  }

  /**
   * Close the browser and clean up resources
   */
  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      logger.debug("🔒 Browser closed successfully");
    } catch (error) {
      logger.warn(`⚠️ Error closing browser: ${error}`);
    }
  }
}
