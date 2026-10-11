import type { Browser, Page } from "playwright";
import { ScraperAccessPolicy } from "../../utils/accessPolicy";
import type { AppConfig } from "../../utils/config";
import { HttpStatusError, RedirectError, ScraperError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { FingerprintGenerator } from "./FingerprintGenerator";
import {
  DEFAULT_BROWSER_USER_AGENT,
  getHeader,
  withMarkdownPreferredAccept,
  withoutSecFetchHeaders,
} from "./headers";
import { ManagedBrowser } from "./ManagedBrowser";
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
  private readonly managedBrowser: ManagedBrowser;
  private fingerprintGenerator: FingerprintGenerator;
  private readonly defaultTimeoutMs: number;
  private readonly accessPolicy: ScraperAccessPolicy;

  /**
   * @param scraperConfig - Scraper settings (timeouts, network policy).
   * @param managedBrowser - The browser to fetch with; pass one to share it
   * with other users, such as the HTML renderer.
   */
  constructor(
    scraperConfig: AppConfig["scraper"],
    managedBrowser = new ManagedBrowser(scraperConfig),
  ) {
    this.managedBrowser = managedBrowser;
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
    try {
      options?.signal?.throwIfAborted();
      await this.accessPolicy.assertNetworkUrlAllowed(source);

      const browser = await this.managedBrowser.get();
      try {
        return await this.fetchWithBrowser(browser, source, options);
      } catch (error) {
        if (this.managedBrowser.isCurrent(browser) || options?.signal?.aborted) {
          throw error;
        }
        // The browser went away under this page: Chromium exited (e.g. under
        // memory pressure), or another user retired it. The page never got a
        // fair attempt, so give it one more on the current browser.
        logger.warn(`⚠️  Browser closed while fetching ${source}, retrying once`);
        return await this.fetchWithBrowser(
          await this.managedBrowser.get(),
          source,
          options,
        );
      }
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new ScraperError("Browser fetch cancelled", false);
      }

      // Preserve already-typed ScraperErrors (and their isRetryable flag) thrown
      // by fetchWithBrowser or fetchViaRequest, rather than re-wrapping them
      // into a new, always-non-retryable error.
      if (error instanceof ScraperError) {
        throw error;
      }

      logger.error(`❌ Browser fetch failed for ${source}: ${error}`);
      throw new ScraperError(
        `Browser fetch failed for ${source}: ${error instanceof Error ? error.message : String(error)}`,
        false,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Loads `source` in a fresh context of the given browser.
   *
   * @param browser - The browser to open the page in.
   * @param source - The URL to fetch.
   * @param options - Headers, timeout and redirect policy for the fetch.
   * @returns The fetched raw content.
   */
  private async fetchWithBrowser(
    browser: Browser,
    source: string,
    options?: FetchOptions,
  ): Promise<RawContent> {
    let page: Page | null = null;
    let browserContext: { newPage(): Promise<Page>; close(): Promise<void> } | null =
      null;
    // Aborting closes the context, which ends a navigation in progress instead
    // of letting it run until it times out.
    const closeOnAbort = (): void => {
      void browserContext?.close().catch(() => undefined);
    };
    options?.signal?.addEventListener("abort", closeOnAbort, { once: true });

    try {
      const fingerprintHeaders = this.fingerprintGenerator.generateHeaders();
      browserContext = await browser.newContext({
        userAgent:
          getHeader(options?.headers, "user-agent") ||
          fingerprintHeaders["user-agent"] ||
          DEFAULT_BROWSER_USER_AGENT,
        ignoreHTTPSErrors: this.accessPolicy.shouldAllowInvalidTls(
          "https://browser-context.local",
        ),
      });
      // An abort before the context existed had nothing to close.
      options?.signal?.throwIfAborted();
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
      // Chromium sets the Sec-Fetch-* headers itself; overriding them would make
      // it fail the page's scripts, styles and other sub-resources. The request
      // API is Playwright's own client, so it keeps them.
      await page.setExtraHTTPHeaders(withoutSecFetchHeaders(requestHeaders));

      // Set timeout
      const timeout = options?.timeout || this.defaultTimeoutMs;

      // Navigate to the page. Gate on "load" rather than "networkidle": many
      // sites keep background connections open indefinitely (analytics,
      // Cloudflare telemetry, websockets), so "networkidle" never settles and
      // page.goto times out even though the document is already available.
      logger.debug(`Navigating to ${source} with browser...`);
      // page.goto() returns the *first* main-document response. A challenge
      // page typically navigates again once it clears, so the status that
      // matters is the last one the main frame received.
      let lastMainFrameResponse: Awaited<ReturnType<typeof page.goto>> = null;
      page.on("response", (candidate) => {
        const request = candidate.request();
        if (request.isNavigationRequest() && request.frame() === page?.mainFrame()) {
          lastMainFrameResponse = candidate;
        }
      });
      let response: Awaited<ReturnType<typeof page.goto>>;
      try {
        response = await page.goto(source, { waitUntil: "load", timeout });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Non-navigable resources (Markdown, JSON, binary files, ...) make the
        // browser begin a download, so page.goto rejects with
        // ERR_INVALID_ARGUMENT / ERR_ABORTED, or with "Download is starting"
        // while requests are routed. Fetch those through the context's request
        // API instead (see fetchViaRequest): it shares cookies — so any
        // anti-bot clearance carries over — but does not try to render them.
        // A navigation cut off because its page or browser is going away (for
        // example, the browser was replaced) is reported as ERR_ABORTED too,
        // with "frame was detached"; that is no download, so it is not
        // fetched again here.
        const frameDetached = /frame was detached/i.test(message);
        if (
          !frameDetached &&
          /ERR_INVALID_ARGUMENT|ERR_ABORTED|Download is starting/i.test(message)
        ) {
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

      // If the browser did not get past the block, the error page it rendered
      // is not documentation — returning it SUCCESS would index the block page.
      // Mirrors the status check fetchViaRequest already performs.
      // A challenge navigates again once it clears, so everything downstream —
      // content type, body, etag — must come from the document that actually
      // ended up loaded, not from the one page.goto() first returned.
      response = lastMainFrameResponse ?? response;
      const finalStatus = response.status();
      if (finalStatus === 404) {
        logger.debug(`Browser navigation to ${source} returned 404`);
        return {
          content: Buffer.from(""),
          mimeType: "text/plain",
          source: finalUrl,
          status: FetchStatus.NOT_FOUND,
        } satisfies RawContent;
      }
      if (finalStatus >= 400) {
        throw new HttpStatusError(
          `Browser navigation to ${source} returned status ${finalStatus}`,
          true,
          finalStatus,
        );
      }

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
    } finally {
      options?.signal?.removeEventListener("abort", closeOnAbort);
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
   * @param headers - The composed fingerprint and caller headers, including
   * any Sec-Fetch-* values among them. The page itself leaves those to
   * Chromium; the request-API call sends them as composed, so it presents the
   * same client identity as the browser that (potentially) just solved a
   * challenge.
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

    // Same semantics as the navigation path: a 404 is a definitive answer that
    // refresh uses to delete a stale page and that llms.txt seeds treat as
    // non-fatal, so it must not surface as a generic failure.
    if (response.status() === 404) {
      logger.debug(`Browser request for ${source} returned 404`);
      return {
        content: Buffer.from(""),
        mimeType: "text/plain",
        source: finalUrl,
        status: FetchStatus.NOT_FOUND,
      } satisfies RawContent;
    }
    if (!response.ok()) {
      throw new HttpStatusError(
        `Browser request for ${source} returned status ${response.status()}`,
        true,
        response.status(),
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

  /**
   * Closes the browser this fetcher uses.
   */
  async close(): Promise<void> {
    await this.managedBrowser.close();
  }
}
