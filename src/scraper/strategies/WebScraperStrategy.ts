/**
 * Web scraper strategy that normalizes URLs, fetches content with automatic
 * fetcher selection, and routes content through pipelines. Requires resolved
 * configuration from the entrypoint to avoid implicit config loading.
 */
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProgressCallback } from "../../types";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import type { UrlNormalizerOptions } from "../../utils/url";
import { AutoDetectFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem, ScraperOptions, ScraperProgressEvent } from "../types";
import { convertToString } from "../utils/buffer";
import { isLlmsTxtUrl, type LlmsTxtResult, parseLlmsTxt } from "../utils/llmsTxtParser";
import { isPathDescendant } from "../utils/scope";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";
import { LocalFileStrategy } from "./LocalFileStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

interface LlmsTxtProbeResult {
  url: string;
  result: LlmsTxtResult;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly fetcher: AutoDetectFetcher;
  private readonly shouldFollowLinkFn?: (baseUrl: URL, targetUrl: URL) => boolean;
  private readonly pipelines: ContentPipeline[];
  private readonly localFileStrategy: LocalFileStrategy;
  private tempFiles: string[] = [];
  private siblingwiseRedirectWarned = false;
  private pendingLlmsTxtProbe: LlmsTxtProbeResult | null = null;

  constructor(config: AppConfig, options: WebScraperStrategyOptions = {}) {
    super(config, { urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
    this.fetcher = new AutoDetectFetcher(config.scraper);
    this.pipelines = PipelineFactory.createStandardPipelines(config);
    this.localFileStrategy = new LocalFileStrategy(config);
  }

  canHandle(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
    } catch {
      return false;
    }
  }

  private restorePreservedHash(requestedUrl: string, actualUrl: string): string {
    if (!requestedUrl.includes("#")) {
      return actualUrl;
    }

    try {
      const requested = new URL(requestedUrl);
      const actual = new URL(actualUrl);
      const normalizePathname = (pathname: string): string =>
        pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
      if (
        requested.origin === actual.origin &&
        normalizePathname(requested.pathname) === normalizePathname(actual.pathname) &&
        requested.search === actual.search
      ) {
        actual.hash = requested.hash;
        return actual.toString();
      }
    } catch {
      return actualUrl;
    }

    return actualUrl;
  }

  // Removed custom isInScope logic; using shared scope utility for consistent behavior

  private createFetchOptions(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ) {
    return {
      signal,
      followRedirects: options.followRedirects,
      headers: options.headers,
      etag: item.etag,
      ...(item.internalAllowedFileRoots
        ? { internalAllowedFileRoots: item.internalAllowedFileRoots }
        : {}),
    };
  }

  private buildMarkdownVariantUrl(url: string): string {
    const variant = new URL(url);
    if (variant.pathname.endsWith("/")) {
      variant.pathname = `${variant.pathname}index.html.md`;
      return variant.toString();
    }

    const lastSegment = variant.pathname.split("/").at(-1) ?? "";
    if (lastSegment.includes(".")) {
      variant.pathname = `${variant.pathname}.md`;
      return variant.toString();
    }

    variant.pathname = `${variant.pathname}/index.html.md`;
    return variant.toString();
  }

  private isAcceptableMarkdownVariant(rawContent: RawContent): boolean {
    const mimeType = rawContent.mimeType.toLowerCase();
    return MimeTypeUtils.isMarkdown(mimeType) || mimeType === "text/plain";
  }

  private isMarkdownUrl(url: string): boolean {
    const mimeType = MimeTypeUtils.detectMimeTypeFromPath(url);
    return mimeType ? MimeTypeUtils.isMarkdown(mimeType) : false;
  }

  private async fetchItemContent(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<RawContent> {
    const fetchOptions = this.createFetchOptions(item, options, signal);

    if (!item.fromLlmsTxt || this.isMarkdownUrl(item.url)) {
      return this.fetcher.fetch(item.url, fetchOptions);
    }

    const markdownVariantUrl = this.buildMarkdownVariantUrl(item.url);
    try {
      const markdownContent = await this.fetcher.fetch(markdownVariantUrl, fetchOptions);
      if (
        markdownContent.status === FetchStatus.SUCCESS &&
        this.isAcceptableMarkdownVariant(markdownContent)
      ) {
        logger.debug(
          `llms.txt Markdown URL preference succeeded: ${item.url} -> ${markdownVariantUrl}`,
        );
        return MimeTypeUtils.isMarkdown(markdownContent.mimeType)
          ? markdownContent
          : { ...markdownContent, mimeType: "text/markdown" };
      }

      logger.debug(
        `llms.txt Markdown URL preference fell back for ${item.url}: ${markdownVariantUrl} returned status=${markdownContent.status}, contentType=${markdownContent.mimeType}`,
      );
    } catch (error) {
      logger.debug(
        `llms.txt Markdown URL preference fell back for ${item.url}: ${error}`,
      );
    }

    return this.fetcher.fetch(item.url, fetchOptions);
  }

  private getLlmsTxtCandidates(baseUrl: string, inputUrl: string): string[] {
    const input = new URL(inputUrl);
    const parentPath = input.pathname.endsWith("/")
      ? input.pathname
      : input.pathname.slice(0, input.pathname.lastIndexOf("/") + 1);
    input.pathname = `${parentPath}llms.txt`.replace(/\/+/g, "/");
    input.search = "";
    input.hash = "";

    const root = new URL(baseUrl);
    root.pathname = "/llms.txt";
    root.search = "";
    root.hash = "";

    return [...new Set([input.toString(), root.toString()])];
  }

  /**
   * Probes for an llms.txt file using the existing fetcher and access policy.
   * @param baseUrl The site base URL used for the root fallback probe.
   * @param inputUrl The original input URL used for the subpath probe.
   * @param options Scraper options to apply to probe requests.
   * @param signal Optional abort signal.
   * @returns The first valid llms.txt result, or null when none is available.
   */
  async probeLlmsTxt(
    baseUrl: string,
    inputUrl: string,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<LlmsTxtProbeResult | null> {
    for (const candidate of this.getLlmsTxtCandidates(baseUrl, inputUrl)) {
      try {
        const rawContent = await this.fetcher.fetch(
          candidate,
          this.createFetchOptions({ url: candidate, depth: 0 }, options, signal),
        );
        if (rawContent.status !== FetchStatus.SUCCESS) {
          logger.debug(`llms.txt probe failed for ${candidate}: ${rawContent.status}`);
          continue;
        }

        const result = parseLlmsTxt(
          convertToString(rawContent.content, rawContent.charset),
        );
        if (result.links.length === 0) {
          logger.debug(`llms.txt probe failed for ${candidate}: invalid content`);
          continue;
        }

        logger.info(
          `📄 Detected llms.txt at ${rawContent.source} (${result.links.length} URLs)`,
        );
        return { url: rawContent.source, result };
      } catch (error) {
        logger.debug(`llms.txt probe failed for ${candidate}: ${error}`);
      }
    }

    return null;
  }

  private createLlmsTxtQueueItems(
    options: ScraperOptions,
    probe: LlmsTxtProbeResult,
  ): QueueItem[] {
    const items: QueueItem[] = [];

    for (const link of probe.result.links) {
      try {
        const targetUrl = new URL(link.url, probe.url);
        if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
          continue;
        }
        if (!this.shouldProcessUrl(targetUrl.href, options)) {
          continue;
        }
        if (this.shouldFollowLinkFn) {
          const baseUrl = this.canonicalBaseUrl ?? new URL(options.url);
          if (!this.shouldFollowLinkFn(baseUrl, targetUrl)) {
            continue;
          }
        }
        items.push({ url: targetUrl.href, depth: 0, fromLlmsTxt: true });
      } catch {}
    }

    return items;
  }

  private consumePendingLlmsTxtQueueItems(
    item: QueueItem,
    options: ScraperOptions,
  ): QueueItem[] {
    if (item.depth !== 0) {
      return [];
    }

    const probe = this.pendingLlmsTxtProbe;
    this.pendingLlmsTxtProbe = null;

    return probe ? this.createLlmsTxtQueueItems(options, probe) : [];
  }

  private updateCanonicalBaseUrl(effectiveSource: string, options: ScraperOptions): void {
    // Protocol and host are always adopted from the redirected URL so cross-origin redirects
    // (http->https, apex<->www, port changes) don't drop every discovered link via the host check.
    // Keep the user-provided path as the scope anchor: callers who start at `/docs` expect the
    // whole docs subtree even when the server redirects that index URL to a concrete page.
    const final = new URL(effectiveSource);
    const userPath = new URL(options.url).pathname;
    if (!isPathDescendant(userPath, final.pathname) && !this.siblingwiseRedirectWarned) {
      logger.warn(
        `⚠️  Depth-0 redirect changed path siblingwise. Scope anchor remains the user-provided path; ` +
          `discovered links under the redirected path will not be in scope. ` +
          `Requested: ${options.url} → Final: ${effectiveSource} → Scope anchor: ${userPath}. ` +
          `If the redirected path is intended, resubmit with that URL.`,
      );
      this.siblingwiseRedirectWarned = true;
    }
    final.pathname = userPath;
    this.canonicalBaseUrl = final;
  }

  /**
   * Processes a single queue item by fetching its content and processing it through pipelines.
   * @param item - The queue item to process.
   * @param options - Scraper options including headers for HTTP requests.
   * @param _progressCallback - Optional progress callback (not used here).
   * @param signal - Optional abort signal for request cancellation.
   * @returns An object containing the processed document and extracted links.
   */
  protected override async processItem(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    const { url } = item;

    try {
      if (isLlmsTxtUrl(url)) {
        logger.debug(`Skipping llms.txt meta-file: ${url}`);
        return { url, links: [], status: FetchStatus.SUCCESS };
      }

      // Log when processing with ETag for conditional requests
      if (item.etag) {
        logger.debug(`Processing ${url} with stored ETag: ${item.etag}`);
      }

      // Check for Archive Root URL (only if depth 0)
      if (item.depth === 0) {
        const isArchive = /\.(zip|tar|gz|tgz)$/i.test(new URL(url).pathname);
        if (isArchive) {
          return this.processRootArchive(item, options, signal);
        }
      }

      // Use AutoDetectFetcher which handles fallbacks automatically
      const rawContent = await this.fetchItemContent(item, options, signal);
      const effectiveSource = options.preserveHashes
        ? this.restorePreservedHash(url, rawContent.source)
        : rawContent.source;
      if (item.depth === 0) {
        this.updateCanonicalBaseUrl(effectiveSource, options);
      }
      const llmsTxtQueueItems = this.consumePendingLlmsTxtQueueItems(item, options);

      logger.debug(
        `Fetch result for ${url}: status=${rawContent.status}, etag=${rawContent.etag || "none"}`,
      );

      // Return the status directly - BaseScraperStrategy handles NOT_MODIFIED and NOT_FOUND
      // Use the final URL from rawContent.source (which may differ due to redirects)
      if (rawContent.status !== FetchStatus.SUCCESS) {
        logger.debug(`Skipping pipeline for ${url} due to status: ${rawContent.status}`);
        return {
          url: effectiveSource,
          links: [],
          queueItems: llmsTxtQueueItems,
          status: rawContent.status,
        };
      }

      if (MimeTypeUtils.isMarkdown(rawContent.mimeType)) {
        logger.debug(
          `Server provided Markdown content for ${url} via content negotiation or Markdown URL (${rawContent.mimeType})`,
        );
      }

      // --- Start Pipeline Processing ---
      let processed: PipelineResult | undefined;
      for (const pipeline of this.pipelines) {
        const contentBuffer = Buffer.isBuffer(rawContent.content)
          ? rawContent.content
          : Buffer.from(rawContent.content);
        if (pipeline.canProcess(rawContent.mimeType || "text/plain", contentBuffer)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${rawContent.mimeType}" (${url})`,
          );
          processed = await pipeline.process(
            { ...rawContent, source: effectiveSource },
            options,
            this.fetcher,
          );
          break;
        }
      }

      if (!processed) {
        // If content type is unsupported (e.g. binary/archive encountered during crawl), we just skip
        logger.warn(
          `⚠️  Unsupported content type "${rawContent.mimeType}" for URL ${url}. Skipping processing.`,
        );
        return {
          url: effectiveSource,
          links: [],
          queueItems: llmsTxtQueueItems,
          status: FetchStatus.SUCCESS,
        };
      }

      // Log errors from pipeline
      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }

      // Check if content processing resulted in usable content
      if (!processed.textContent?.trim()) {
        logger.warn(
          `⚠️  No processable content found for ${url} after pipeline execution.`,
        );
        return {
          url: effectiveSource,
          links: processed.links,
          queueItems: llmsTxtQueueItems,
          status: FetchStatus.SUCCESS,
        };
      }

      const filteredLinks =
        processed.links?.flatMap((link) => {
          try {
            const targetUrl = new URL(link, effectiveSource);

            // Check for archive links during crawl - ignore them
            if (/\.(zip|tar|gz|tgz)$/i.test(targetUrl.pathname)) {
              return [];
            }

            // Use the base class's shouldProcessUrl which handles scope + include/exclude patterns
            if (!this.shouldProcessUrl(targetUrl.href, options)) {
              return [];
            }
            // Apply optional custom filter function if provided
            if (this.shouldFollowLinkFn) {
              const baseUrl = this.canonicalBaseUrl ?? new URL(options.url);
              return this.shouldFollowLinkFn(baseUrl, targetUrl) ? [targetUrl.href] : [];
            }
            return [targetUrl.href];
          } catch {
            return [];
          }
        }) ?? [];

      return {
        url: effectiveSource,
        etag: rawContent.etag,
        lastModified: rawContent.lastModified,
        sourceContentType: rawContent.mimeType,
        contentType: processed.contentType || rawContent.mimeType,
        content: processed,
        links: filteredLinks,
        queueItems: llmsTxtQueueItems,
        status: FetchStatus.SUCCESS,
      };
    } catch (error) {
      // Log fetch errors or pipeline execution errors (if run throws)
      logger.error(`❌ Failed processing page ${url}: ${error}`);
      throw error;
    }
  }

  async scrape(
    options: ScraperOptions,
    progressCallback: ProgressCallback<ScraperProgressEvent>,
    signal?: AbortSignal,
  ): Promise<void> {
    this.pendingLlmsTxtProbe = null;
    this.pendingLlmsTxtProbe = await this.probeLlmsTxt(
      options.url,
      options.url,
      options,
      signal,
    );

    await super.scrape(options, progressCallback, signal);
  }

  private async processRootArchive(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<ProcessItemResult> {
    logger.info(`📦 Downloading root archive: ${item.url}`);

    // We need to stream the download to a temp file
    // Since fetcher.fetch returns a buffer (usually), we might want to bypass it or use it if small enough?
    // But archives can be huge. fetcher.fetch currently loads into memory.
    // For now, let's assume we can use fetcher but warn about memory, OR implement stream download here.
    // Our fetcher abstraction returns RawContent with Buffer.
    // If we want to stream, we might need to access the underlying axios/fetch stream.
    // `AutoDetectFetcher` doesn't expose stream easily.
    // Ideally we refactor fetcher to support streams, but that's out of scope.
    // So we will use fetcher and write buffer to temp file.
    // LIMITATION: Large archives will hit memory limits.

    const rawContent = await this.fetcher.fetch(item.url, {
      signal,
      headers: options.headers,
    });

    if (rawContent.status !== FetchStatus.SUCCESS) {
      return { url: rawContent.source, links: [], status: rawContent.status };
    }

    const buffer = Buffer.isBuffer(rawContent.content)
      ? rawContent.content
      : Buffer.from(rawContent.content);

    const tempDir = os.tmpdir();
    const tempFile = path.join(
      tempDir,
      `scraper-${Date.now()}-${path.basename(new URL(item.url).pathname)}`,
    );

    // Track file immediately so we can clean it up if write fails or later
    this.tempFiles.push(tempFile);

    await fsPromises.writeFile(tempFile, buffer);

    // Delegate to LocalFileStrategy
    const localUrl = `file://${tempFile}`;
    const localItem = { ...item, url: localUrl };
    const localOptions = {
      ...options,
      internalAllowedFileRoots: [...(options.internalAllowedFileRoots ?? []), tempFile],
    };

    const result = await this.localFileStrategy.processItem(
      localItem,
      localOptions,
      signal,
    );

    // We need to fix up the links to point back to something meaningful?
    // If we process a zip, we get file:///tmp/.../file.txt
    // These links are only useful if we continue to treat them as local files for this session.
    // But `WebScraper` expects http links usually?
    // Actually, if we return file:// links, the queue might try to fetch them.
    // `WebScraperStrategy` handles http/https. `LocalFileStrategy` handles file://.
    // If we return file:// links, the scraper will need to route them to `LocalFileStrategy`.
    // The `ScraperService` uses `ScraperRegistry` to pick strategy.
    // So file:// links will work!

    return {
      ...result,
      url: item.url, // Keep original URL as the source of this item
      links: result.links,
      internalAllowedFileRoots: [tempFile],
      // links are file://...
    };
  }

  /**
   * Cleanup resources used by this strategy, specifically the pipeline browser instances and fetcher.
   */
  async cleanup(): Promise<void> {
    await Promise.allSettled([
      ...this.pipelines.map((pipeline) => pipeline.close()),
      this.localFileStrategy.cleanup(),
      this.fetcher.close(),
      ...this.tempFiles.map((file) => fsPromises.unlink(file).catch(() => {})),
    ]);
  }
}
