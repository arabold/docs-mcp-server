import { type Browser, chromium, type Page } from "playwright";
import { ScraperAccessPolicy } from "../../utils/accessPolicy";
import type { AppConfig } from "../../utils/config";
import { RedirectError, ScraperError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { FingerprintGenerator } from "./FingerprintGenerator";
import { withMarkdownPreferredAccept } from "./headers";
import {
  type ContentFetcher,
  type FetchOptions,
  FetchStatus,
  type RawContent,
} from "./types";

/**
 * Maximum redirects to follow via the request API. Matches Playwright's own
 * default (20) — redirects are followed manually only so every hop can be
 * revalidated against the access policy, not to change the allowed depth.
 */
const MAX_REQUEST_REDIRECTS = 20;

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

      // Compose the browser-like fingerprint headers used both for the page's
      // own navigation and (if needed) the non-navigable request-API fallback,
      // so the two look like the same client to anti-bot checks.
      const requestHeaders = withMarkdownPreferredAccept(
        {
          ...fingerprintHeaders,
          ...options?.headers,
        },
        options?.headers,
      );
      await page.setExtraHTTPHeaders(requestHeaders);

      // Set timeout
      const timeout = options?.timeout || this.defaultTimeoutMs;

      // Navigate to the page. Gate on "load" rather than "networkidle": many
      // sites keep background connections open indefinitely (analytics,
      // Cloudflare telemetry, websockets), so "networkidle" never settles and
      // page.goto times out even though the document is already available.
      logger.debug(`Navigating to ${source} with browser...`);
      let response: Awaited<ReturnType<typeof page.goto>>;
      try {
        response = await page.goto(source, { waitUntil: "load", timeout });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Non-navigable resources (Markdown, JSON, plain text, ...) make the
        // browser begin a download, so page.goto rejects with
        // ERR_INVALID_ARGUMENT / ERR_ABORTED. Fetch those through the context's
        // request API instead (see fetchViaRequest): it shares cookies — so any
        // anti-bot clearance carries over — but does not try to render them.
        if (/ERR_INVALID_ARGUMENT|ERR_ABORTED/i.test(message)) {
          return await this.fetchViaRequest(
            page,
            source,
            options,
            timeout,
            requestHeaders,
          );
        }
        throw error;
      }

      // Best-effort: give the network a moment to settle (e.g. so a JS
      // challenge can finish) but never fail the fetch if it never goes idle.
      await page
        .waitForLoadState("networkidle", { timeout: Math.min(timeout, 5_000) })
        .catch(() => undefined);

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
          throw new RedirectError(source, location, response.status());
        }
      }

      // Get the final URL after any redirects
      const finalUrl = page.url();
      await this.accessPolicy.assertNetworkUrlAllowed(finalUrl);

      // Determine content type
      const contentType = response.headers()["content-type"] || "text/html";
      const { mimeType, charset } = MimeTypeUtils.parseContentType(contentType);

      const content = MimeTypeUtils.isHtml(mimeType)
        ? await page.content()
        : await response.body();
      const contentBuffer = Buffer.isBuffer(content)
        ? content
        : Buffer.from(content, "utf-8");

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

      // Preserve already-typed ScraperErrors (and their isRetryable flag) thrown
      // earlier in this method or in fetchViaRequest, rather than re-wrapping
      // them into a new, always-non-retryable error.
      if (error instanceof ScraperError) {
        throw error;
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

  /**
   * Fetches a resource the browser cannot navigate to (Markdown, JSON, plain
   * text, ...). Loads the origin first so any JS/anti-bot challenge is solved
   * and clearance cookies are set on the shared context, then retrieves the
   * resource bytes via the context's request API (which reuses those cookies
   * but does not attempt to render the response as a document).
   *
   * @param page - The page whose context (and cookies) the request reuses.
   * @param source - The non-navigable resource URL to fetch.
   * @param options - The original fetch options (headers, redirect policy).
   * @param timeout - Navigation/request timeout in milliseconds.
   * @param headers - The same composed fingerprint/Accept headers set on the
   * page via `setExtraHTTPHeaders`, so the request-API call presents the same
   * client identity as the browser that (potentially) just solved a challenge.
   * @returns The fetched raw content.
   */
  private async fetchViaRequest(
    page: Page,
    source: string,
    options: FetchOptions | undefined,
    timeout: number,
    headers: Record<string, string>,
  ): Promise<RawContent> {
    const origin = new URL(source).origin;
    logger.debug(
      `Resource ${source} is not browser-navigable; clearing ${origin} then fetching via request API`,
    );
    // Visit a navigable page on the same origin so the browser can solve any JS
    // challenge and set clearance cookies; ignore failures since the request
    // below still returns a definitive status.
    await page
      .goto(origin, { waitUntil: "load", timeout })
      .then(() =>
        page
          .waitForLoadState("networkidle", { timeout: Math.min(timeout, 5_000) })
          .catch(() => undefined),
      )
      .catch(() => undefined);

    const { response, finalUrl } = await this.requestWithValidatedRedirects(
      page,
      source,
      options,
      timeout,
      headers,
    );

    if (!response.ok()) {
      throw new ScraperError(
        `Browser request for ${source} returned status ${response.status()}`,
        true,
      );
    }

    const contentType = response.headers()["content-type"] || "application/octet-stream";
    const { mimeType, charset } = MimeTypeUtils.parseContentType(contentType);
    const content = Buffer.from(await response.body());

    return {
      content,
      mimeType,
      charset,
      encoding: undefined,
      source: finalUrl,
      etag: response.headers().etag,
      status: FetchStatus.SUCCESS,
    } satisfies RawContent;
  }

  /**
   * Fetches `source` via the context's request API, following redirects
   * manually so every hop can be revalidated against the access policy before
   * it's followed — `page.request` bypasses the `page.route` handler that
   * guards browser-driven navigation, so this is the only SSRF check a
   * redirect target gets.
   *
   * @param page - The page whose context the request reuses.
   * @param source - The resource URL to fetch.
   * @param options - The original fetch options (redirect policy).
   * @param timeout - Request timeout in milliseconds, applied per hop.
   * @param headers - Headers to send with every hop (see `fetchViaRequest`).
   * @returns The final response and the URL it was fetched from.
   */
  private async requestWithValidatedRedirects(
    page: Page,
    source: string,
    options: FetchOptions | undefined,
    timeout: number,
    headers: Record<string, string>,
  ): Promise<{
    response: Awaited<ReturnType<Page["request"]["get"]>>;
    finalUrl: string;
  }> {
    let currentUrl = source;

    for (let redirectCount = 0; ; redirectCount++) {
      const response = await page.request.get(currentUrl, {
        headers,
        maxRedirects: 0,
        timeout,
      });

      const status = response.status();
      const location = response.headers().location;
      if (status < 300 || status >= 400 || !location) {
        return { response, finalUrl: currentUrl };
      }

      if (options?.followRedirects === false) {
        throw new RedirectError(currentUrl, location, status);
      }

      if (redirectCount >= MAX_REQUEST_REDIRECTS) {
        throw new ScraperError(`Too many redirects while fetching ${source}`, false);
      }

      const redirectUrl = new URL(location, currentUrl).href;
      await this.accessPolicy.assertNetworkUrlAllowed(redirectUrl);
      currentUrl = redirectUrl;
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
