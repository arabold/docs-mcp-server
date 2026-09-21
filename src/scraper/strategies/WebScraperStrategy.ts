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
import {
  normalizeUrl,
  stripMarkdownExtension,
  type UrlNormalizerOptions,
} from "../../utils/url";
import { AutoDetectFetcher } from "../fetcher";
import { FetchStatus, type RawContent } from "../fetcher/types";
import {
  createMimeTypeCapabilityPredicate,
  type MimeTypeCapabilityPredicate,
} from "../pipelines/capability";
import { PipelineFactory } from "../pipelines/PipelineFactory";
import type { ContentPipeline, PipelineResult } from "../pipelines/types";
import type { QueueItem, ScraperOptions, ScraperProgressEvent } from "../types";
import { convertToString } from "../utils/buffer";
import { isLlmsTxtUrl, type LlmsTxtResult, parseLlmsTxt } from "../utils/llmsTxtParser";
import { isFileLikePath, isPathDescendant } from "../utils/scope";
import { BaseScraperStrategy, type ProcessItemResult } from "./BaseScraperStrategy";
import { LocalFileStrategy } from "./LocalFileStrategy";

export interface WebScraperStrategyOptions {
  urlNormalizerOptions?: UrlNormalizerOptions;
  shouldFollowLink?: (baseUrl: URL, targetUrl: URL) => boolean;
}

/**
 * Matches paths naming an archive we know how to unpack.
 *
 * This is a policy statement, not a capability one, which is why it is not
 * expressed through the pipeline capability predicate: archives are readable —
 * `processRootArchive` unpacks one when it is the start URL — but following them
 * mid-crawl is deliberately declined. The two call sites act on the same test in
 * opposite directions, so they share this helper rather than the literal.
 *
 * @param pathname The URL pathname to test.
 * @returns True when the path names a supported archive.
 */
function isArchivePath(pathname: string): boolean {
  return /\.(zip|tar|gz|tgz)$/i.test(pathname);
}

interface LlmsTxtProbeResult {
  url: string;
  result: LlmsTxtResult;
}

export class WebScraperStrategy extends BaseScraperStrategy {
  private readonly fetcher: AutoDetectFetcher;
  private readonly shouldFollowLinkFn?: (baseUrl: URL, targetUrl: URL) => boolean;
  private readonly pipelines: ContentPipeline[];
  private readonly canProcessMimeType: MimeTypeCapabilityPredicate;
  private readonly localFileStrategy: LocalFileStrategy;
  private tempFiles: string[] = [];
  private siblingwiseRedirectWarned = false;
  private pendingLlmsTxtProbe: LlmsTxtProbeResult | null = null;

  constructor(config: AppConfig, options: WebScraperStrategyOptions = {}) {
    super(config, { urlNormalizerOptions: options.urlNormalizerOptions });
    this.shouldFollowLinkFn = options.shouldFollowLink;
    this.fetcher = new AutoDetectFetcher(config.scraper);
    this.pipelines = PipelineFactory.createStandardPipelines(config);
    this.canProcessMimeType = createMimeTypeCapabilityPredicate(this.pipelines);
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
      // Fetch-time gate. The fetcher stays ignorant of pipelines; it is simply
      // told what this strategy is able to read.
      acceptsMimeType: this.canProcessMimeType,
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

  /**
   * Records a web page under its canonical URL.
   *
   * Web URLs are the case the shared normaliser was written for: a server
   * returns the same bytes for `/config` and `/config/`, and for a directory and
   * its index file, so those spellings name one page.
   */
  protected override canonicalizeStoredUrl(
    url: string,
    scrapeOptions: ScraperOptions,
  ): string {
    return normalizeUrl(url, this.getUrlNormalizerOptions(scrapeOptions));
  }

  /**
   * Chooses the content type a Markdown variant should be parsed as.
   *
   * Sites disagree on how to serve a `.md` file: vite.dev sends `text/markdown`,
   * react.dev sends `text/plain`. Both are Markdown documents, so both are
   * parsed as Markdown — the extension is the author's statement about the
   * format, and the plain-text pipeline would throw away every heading.
   *
   * This governs parsing only. The served type is reported unchanged, because
   * that is what the store's precedence rule reads: a `text/plain` body is
   * equally consistent with a real document and with a soft error page served
   * at a `.md` address that has none, and recording it as Markdown would let
   * the latter outrank the page it was folded onto and never be replaced.
   */
  private asMarkdownRepresentation(url: string, rawContent: RawContent): RawContent {
    if (!this.isMarkdownUrl(url) || !this.isAcceptableMarkdownVariant(rawContent)) {
      return rawContent;
    }
    return MimeTypeUtils.isMarkdown(rawContent.mimeType)
      ? rawContent
      : { ...rawContent, mimeType: "text/markdown" };
  }

  private isAcceptableMarkdownVariant(rawContent: RawContent): boolean {
    const mimeType = rawContent.mimeType.toLowerCase();
    return MimeTypeUtils.isMarkdown(mimeType) || mimeType === "text/plain";
  }

  private isMarkdownUrl(url: string): boolean {
    // Pathname only, for the reason `canProcessDiscoveredLink` documents: given a
    // whole URL the detector reads the host's suffix as an extension, and `.md`
    // is Moldova's ccTLD, so `https://example.md/` would report as Markdown.
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      return false;
    }
    const mimeType = MimeTypeUtils.detectMimeTypeFromPath(pathname);
    return mimeType ? MimeTypeUtils.isMarkdown(mimeType) : false;
  }

  /**
   * Resolves the page identity for a fetched resource.
   *
   * A published Markdown file is a representation of a page rather than a page of
   * its own, so `guide.md` is recorded as `guide`. Both signals are required and
   * they answer different questions: the extension states what the author meant
   * the URL to be, the response states what the server actually returned. The
   * extension alone would fold a soft 404 or an HTML page onto an identity it
   * does not serve; the response alone would rewrite the identity of a document
   * that is legitimately its own resource.
   *
   * Being a property of the response, the rule needs no knowledge of how the URL
   * was discovered or of what else the crawl has seen — which is what lets an
   * `llms.txt` entry and a crawled link converge without ordering guarantees.
   *
   * @param url The URL the content was fetched from, after redirects.
   * @param rawContent The response, consulted for its resolved MIME type.
   * @returns The canonical page URL.
   */
  private resolvePageIdentity(url: string, rawContent: RawContent): string {
    if (!this.isMarkdownUrl(url) || !this.isAcceptableMarkdownVariant(rawContent)) {
      return url;
    }
    const canonical = stripMarkdownExtension(url);
    if (canonical !== url) {
      logger.debug(`Markdown variant ${url} recorded as ${canonical}`);
    }
    return canonical;
  }

  /**
   * Queue-time gate: rejects a discovered link whose path extension names binary
   * media that no configured pipeline can process, before any request is made.
   *
   * Two conditions must both hold, and they answer different questions. The binary
   * media check decides how far to trust an extension; the capability predicate
   * decides what can be processed. Keeping them separate means adding an image
   * pipeline still widens this gate automatically, while a `.csh` or `.tcl` file the
   * `mime` package files under `application/*` is never rejected on its name alone.
   *
   * A null detection means "no opinion" — the link is admitted so the fetch-time
   * gate can decide against the server's actual `Content-Type`. That covers
   * extensionless URLs, unknown extensions, and paths whose only dots sit in a
   * directory segment.
   *
   * @param targetUrl The resolved absolute URL of the discovered link.
   * @returns True when the link should continue through the remaining filters.
   */
  private canProcessDiscoveredLink(targetUrl: URL): boolean {
    const mimeType = MimeTypeUtils.detectMimeTypeFromPath(targetUrl.pathname);
    const isUnreadableMedia =
      !!mimeType &&
      MimeTypeUtils.isBinaryMediaType(mimeType) &&
      !this.canProcessMimeType(mimeType);

    if (!isUnreadableMedia) {
      return true;
    }
    logger.debug(`Skipping ${targetUrl.href}: ${mimeType} is not processable`);
    return false;
  }

  private async fetchItemContent(
    item: QueueItem,
    options: ScraperOptions,
    signal?: AbortSignal,
  ): Promise<RawContent> {
    const fetchOptions = this.createFetchOptions(item, options, signal);

    if (!item.fromLlmsTxt || this.isMarkdownUrl(item.url)) {
      return await this.fetcher.fetch(item.url, fetchOptions);
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
        return markdownContent;
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
    const llmsTxtAt = (base: string, pathname: string): string => {
      const url = new URL(base);
      url.pathname = pathname.replace(/\/+/g, "/");
      url.search = "";
      url.hash = "";
      return url.toString();
    };

    const { pathname } = new URL(inputUrl);
    // Direct subpath candidate (e.g. /paymob-docs -> /paymob-docs/llms.txt).
    // Only for directory-like paths: appending to a file name (/docs/page.html)
    // would probe /docs/page.html/llms.txt, which is a guaranteed 404.
    // Appending to a file name (/docs/page.html, /docs/index) would probe a
    // guaranteed 404, so only directory-like paths get the subpath candidate.
    const isDirectoryLike = !isFileLikePath(pathname);
    // Parent path candidate (e.g. /docs/v1/page.html -> /docs/v1/llms.txt)
    const parentPath = pathname.endsWith("/")
      ? pathname
      : pathname.slice(0, pathname.lastIndexOf("/") + 1);

    return [
      ...new Set([
        ...(isDirectoryLike
          ? [llmsTxtAt(inputUrl, `${pathname.replace(/\/+$/, "")}/llms.txt`)]
          : []),
        llmsTxtAt(inputUrl, `${parentPath}llms.txt`),
        llmsTxtAt(baseUrl, "/llms.txt"),
      ]),
    ];
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
        const { acceptsMimeType: _gate, ...probeOptions } = this.createFetchOptions(
          { url: candidate, depth: 0 },
          options,
          signal,
        );
        const rawContent = await this.fetcher.fetch(candidate, probeOptions);
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
        // Seeds go through the same admission checks as discovered links: an
        // image or archive listed in llms.txt should be rejected at queue time
        // rather than fetched and then discarded.
        if (isArchivePath(targetUrl.pathname)) {
          continue;
        }
        if (!this.canProcessDiscoveredLink(targetUrl)) {
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

      // Check for Archive Root URL (only the user's actual requested root)
      if (this.isRequestedRoot(item, options)) {
        if (isArchivePath(new URL(url).pathname)) {
          return this.processRootArchive(item, options, signal);
        }
      }

      // Use AutoDetectFetcher which handles fallbacks automatically
      const rawContent = await this.fetchItemContent(item, options, signal);
      const fetchedSource = options.preserveHashes
        ? this.restorePreservedHash(url, rawContent.source)
        : rawContent.source;
      // A Markdown variant is recorded under the page it represents, so a `.md`
      // URL and its canonical form resolve to one identity however each was found.
      const effectiveSource = this.resolvePageIdentity(fetchedSource, rawContent);
      if (this.isRequestedRoot(item, options)) {
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
          // Carried so a fatal skip at the requested root can name the type that
          // caused it. Null for 304 and 404, whose MIME type describes nothing.
          sourceContentType: rawContent.mimeType ?? null,
          status: rawContent.status,
        };
      }

      if (MimeTypeUtils.isMarkdown(rawContent.mimeType)) {
        logger.debug(
          `Server provided Markdown content for ${url} via content negotiation or Markdown URL (${rawContent.mimeType})`,
        );
      }

      // --- Start Pipeline Processing ---
      // What to parse it as, which for a `.md` URL served as plain text is not
      // what the server said it was. `rawContent` keeps the served type, which
      // is what gets reported and stored.
      const forParsing = this.asMarkdownRepresentation(fetchedSource, rawContent);
      let processed: PipelineResult | undefined;
      for (const pipeline of this.pipelines) {
        const contentBuffer = Buffer.isBuffer(rawContent.content)
          ? rawContent.content
          : Buffer.from(rawContent.content);
        if (pipeline.canProcess(forParsing.mimeType || "text/plain", contentBuffer)) {
          logger.debug(
            `Selected ${pipeline.constructor.name} for content type "${forParsing.mimeType}" (${url})`,
          );
          processed = await pipeline.process(
            { ...forParsing, source: effectiveSource },
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
          sourceContentType: rawContent.mimeType ?? null,
          // Skipped, not empty: nothing read the body, so we cannot claim the
          // page has no content — and a refresh must not erase what is stored.
          status: FetchStatus.SKIPPED,
        };
      }

      // Log errors from pipeline
      for (const err of processed.errors ?? []) {
        logger.warn(`⚠️  Processing error for ${url}: ${err.message}`);
      }

      // Check if content processing resulted in usable content
      if (!processed.textContent?.trim()) {
        const pipelineFailed = (processed.errors?.length ?? 0) > 0;
        logger.warn(
          `⚠️  No processable content found for ${url} after pipeline execution.`,
        );
        return {
          url: effectiveSource,
          // Recorded here as well as on the non-empty return: an empty page
          // still has a retrieval location, and the base strategy's fallback
          // cannot recover it once the identity has moved — it compares the
          // identity with itself and finds no divergence. Without this the row
          // stores NULL and the next refresh asks the identity while sending
          // the validator the Markdown file issued.
          contentUrl: effectiveSource === fetchedSource ? undefined : fetchedSource,
          title: processed.title ?? null,
          sourceContentType: rawContent.mimeType,
          contentType: processed.contentType || rawContent.mimeType,
          etag: rawContent.etag,
          lastModified: rawContent.lastModified,
          links: processed.links,
          queueItems: llmsTxtQueueItems,
          // A clean run that extracted nothing means the page is empty. An errored
          // run means we learned nothing about it, which is a different fact and
          // gets different handling downstream.
          pipelineFailed,
          status: FetchStatus.SUCCESS,
        };
      }

      const filteredLinks =
        processed.links?.flatMap((link) => {
          try {
            const targetUrl = new URL(link, effectiveSource);

            // Archives are readable but deliberately not followed mid-crawl.
            // This is policy, so it stays separate from the capability gate below.
            if (isArchivePath(targetUrl.pathname)) {
              return [];
            }

            // Reject links whose extension names content no pipeline can read, before
            // any request is issued. Detection is deliberately given the pathname only:
            // passing the href would let a host like `example.zip` or `example.mov`
            // resolve to an archive or video MIME type off its TLD.
            if (!this.canProcessDiscoveredLink(targetUrl)) {
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
        // Recorded only when the bytes came from somewhere other than the
        // page's identity, so a later refresh requests that representation and
        // the validator below goes back to the resource that issued it. Equal
        // values would claim a divergence that does not exist.
        contentUrl: effectiveSource === fetchedSource ? undefined : fetchedSource,
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
