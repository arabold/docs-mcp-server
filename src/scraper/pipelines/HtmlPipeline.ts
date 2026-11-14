import { GreedySplitter } from "../../splitter/GreedySplitter";
import { SemanticMarkdownSplitter } from "../../splitter/SemanticMarkdownSplitter";
import type { AppConfig } from "../../utils/config";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import {
  parseUrl,
  sectionQueryBase,
  sectionSelector,
  sectionSlug,
} from "../../utils/sections";
import type { ManagedBrowser } from "../fetcher/ManagedBrowser";
import type { ContentFetcher, RawContent } from "../fetcher/types";
import { HtmlCheerioParserMiddleware } from "../middleware/HtmlCheerioParserMiddleware";
import { HtmlLinkExtractorMiddleware } from "../middleware/HtmlLinkExtractorMiddleware";
import { HtmlMetadataExtractorMiddleware } from "../middleware/HtmlMetadataExtractorMiddleware";
import { HtmlNormalizationMiddleware } from "../middleware/HtmlNormalizationMiddleware";
import { HtmlPlaywrightMiddleware } from "../middleware/HtmlPlaywrightMiddleware";
import { HtmlSanitizerMiddleware } from "../middleware/HtmlSanitizerMiddleware";
import { HtmlToMarkdownMiddleware } from "../middleware/HtmlToMarkdownMiddleware";
import type { ContentProcessorMiddleware, MiddlewareContext } from "../middleware/types";
import type { ScraperOptions } from "../types";
import { convertToString } from "../utils/buffer";
import { resolveCharset } from "../utils/charset";
import { BasePipeline } from "./BasePipeline";
import type { PipelineResult } from "./types";

/**
 * HtmlPipeline - Processes HTML content into Markdown chunks.
 * Uses Playwright for rendering if needed and Cheerio for semantic extraction.
 */
export class HtmlPipeline extends BasePipeline {
  private readonly playwrightMiddleware: HtmlPlaywrightMiddleware;
  private readonly standardMiddleware: ContentProcessorMiddleware[];
  private readonly greedySplitter: GreedySplitter;

  /**
   * @param config - Application configuration.
   * @param managedBrowser - The browser to render with; pass one to share it
   * with the browser fetcher.
   */
  constructor(config: AppConfig, managedBrowser?: ManagedBrowser) {
    super();

    const preferredChunkSize = config.splitter.preferredChunkSize;
    const maxChunkSize = config.splitter.maxChunkSize;
    const minChunkSize = config.splitter.minChunkSize;

    this.playwrightMiddleware = new HtmlPlaywrightMiddleware(
      config.scraper,
      managedBrowser,
    );
    // Pick the extractor. When the default (`cheerio`) is selected we never
    // touch the Defuddle module — its `defuddle` + `linkedom` dependencies
    // (~2.4 MB combined) stay off the import graph entirely. The Defuddle
    // path lazy-imports on first page, so the cost is paid once when the
    // flag is enabled and never otherwise.
    const extractor: ContentProcessorMiddleware =
      config.scraper.htmlExtractor === "defuddle"
        ? createLazyDefuddleMiddleware()
        : new HtmlSanitizerMiddleware();
    logger.debug(`HtmlPipeline using extractor: ${config.scraper.htmlExtractor}`);
    this.standardMiddleware = [
      new HtmlCheerioParserMiddleware(),
      new HtmlMetadataExtractorMiddleware(),
      new HtmlLinkExtractorMiddleware(),
      extractor,
      new HtmlNormalizationMiddleware(),
      new HtmlToMarkdownMiddleware(),
    ];

    // Create the two-phase splitting: semantic + size optimization
    const semanticSplitter = new SemanticMarkdownSplitter(
      preferredChunkSize,
      maxChunkSize,
    );
    this.greedySplitter = new GreedySplitter(
      semanticSplitter,
      minChunkSize,
      preferredChunkSize,
      maxChunkSize,
    );
  }

  canProcess(mimeType: string): boolean {
    return MimeTypeUtils.isHtml(mimeType);
  }

  async process(
    rawContent: RawContent,
    options: ScraperOptions,
    fetcher?: ContentFetcher,
  ): Promise<PipelineResult> {
    // Use enhanced charset detection that considers HTML meta tags
    const resolvedCharset = resolveCharset(
      rawContent.charset,
      rawContent.content,
      rawContent.mimeType,
    );
    const contentString = convertToString(rawContent.content, resolvedCharset);

    const context: MiddlewareContext = {
      content: contentString,
      contentType: rawContent.mimeType || "text/html",
      source: rawContent.source,
      // metadata: {},
      links: [],
      errors: [],
      options,
      fetcher,
    };

    // Build middleware stack dynamically based on scrapeMode
    let middleware: ContentProcessorMiddleware[] = [...this.standardMiddleware];
    if (options.scrapeMode === "playwright" || options.scrapeMode === "auto") {
      middleware = [this.playwrightMiddleware, ...middleware];
    }

    // Execute the middleware stack using the base class method
    await this.executeMiddlewareStack(middleware, context);

    // Split the content using SemanticMarkdownSplitter (HTML is converted to markdown by middleware)
    const chunks = await this.greedySplitter.splitText(
      typeof context.content === "string" ? context.content : "",
    );

    const headings = new Map<string, Set<string>>();
    const $ = context.dom;
    const source = parseUrl(rawContent.source);
    if ($ && source && /^https?:$/.test(source.protocol) && !options.preserveHashes) {
      const base = sectionQueryBase(source.href);
      const page = new URL(base ?? source.href);
      const linksBySection = new Map<string, string>();
      for (const href of context.links) {
        const target = parseUrl(href);
        const selector = target && sectionSelector(target.href);
        if (
          target &&
          selector &&
          target.origin === page.origin &&
          target.pathname === page.pathname &&
          (target.search === page.search || sectionQueryBase(target.href) === page.href)
        ) {
          linksBySection.set(sectionSlug(selector), target.href);
        }
      }
      $("h1,h2,h3,h4,h5,h6").each((_index, element) => {
        const heading = $(element);
        const slug = sectionSlug(heading.text());
        if (!slug) return;
        const targets = headings.get(slug) ?? new Set<string>();
        headings.set(slug, targets);
        const id = heading.attr("id");
        const linked = linksBySection.get(slug);
        if (linked) {
          targets.add(linked);
        } else if (id) {
          const url = new URL(page);
          url.hash = id;
          targets.add(url.href);
        }
      });
    }

    const base = sectionQueryBase(rawContent.source);
    const selector = sectionSelector(rawContent.source);
    const canonicalHref = $ ? $('link[rel="canonical"]').first().attr("href") : undefined;
    const canonical = canonicalHref && parseUrl(canonicalHref, rawContent.source);
    const sectionPageUrl =
      base &&
      selector &&
      canonical &&
      canonical.href === base &&
      headings.get(sectionSlug(selector))?.has(source?.href ?? "")
        ? base
        : undefined;
    for (const chunk of chunks) {
      const heading = chunk.section.path.at(-1);
      const targets = heading ? headings.get(sectionSlug(heading)) : undefined;
      const [target] = targets?.size === 1 ? targets : [];
      if (target) chunk.section.target = target;
    }

    return {
      title: context.title,
      sectionPageUrl,
      contentType: context.contentType,
      textContent: context.content,
      links: context.links,
      errors: context.errors,
      chunks,
    };
  }

  /**
   * Cleanup resources used by this pipeline, specifically the Playwright browser instance.
   * Errors during cleanup are logged but not propagated to ensure graceful shutdown.
   */
  public async close(): Promise<void> {
    await super.close(); // Call base class close (no-op by default)
    try {
      await this.playwrightMiddleware.closeBrowser();
    } catch (error) {
      // Log error but don't throw - cleanup should be best-effort
      // The closeBrowser method already handles errors internally, but
      // this provides an additional safety layer for unexpected failures
      logger.warn(`⚠️  Error during browser cleanup: ${error}`);
    }
  }
}

/**
 * Build a middleware wrapper that defers loading `HtmlDefuddleMiddleware`
 * (and transitively `defuddle/node` + `linkedom`) until the first HTML page
 * is processed with the `defuddle` extractor selected. Keeps the default
 * `cheerio` path free of the extra dependency cost.
 */
function createLazyDefuddleMiddleware(): ContentProcessorMiddleware {
  let real: ContentProcessorMiddleware | null = null;
  return {
    async process(context, next) {
      if (!real) {
        const mod = await import("../middleware/HtmlDefuddleMiddleware");
        real = new mod.HtmlDefuddleMiddleware();
      }
      await real.process(context, next);
    },
  };
}
