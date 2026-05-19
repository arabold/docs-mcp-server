import * as cheerio from "cheerio";
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";
import { logger } from "../../utils/logger";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Options for HtmlDefuddleMiddleware.
 */
export interface HtmlDefuddleOptions {
  /**
   * If Defuddle's extracted content drops below this fraction of the original
   * *visible* text length (script/style/noscript excluded), fall back to the
   * pre-extraction DOM. Set very low by default — Defuddle is intentionally
   * aggressive, and the more useful safety net is the empty-output check
   * below. The ratio is here mainly to catch catastrophic mis-extraction
   * (Defuddle latches onto a tiny element on a content-rich page).
   */
  minTextRetentionRatio?: number;
}

const DEFAULT_MIN_RETENTION = 0.01;

/**
 * Middleware that runs Defuddle as a drop-in replacement for
 * {@link HtmlSanitizerMiddleware}. It extracts the main article content,
 * removing navigation, footers, ads, and other boilerplate using Defuddle's
 * heuristics rather than a hand-maintained selector list.
 *
 * Pipeline contract:
 * - Reads HTML from `context.dom` (populated by HtmlCheerioParserMiddleware).
 * - Runs Defuddle via linkedom and replaces `context.dom` with a fresh Cheerio
 *   DOM containing only the cleaned content (wrapped in `<html><body>…`).
 * - Honours `context.options.excludeSelectors` by stripping them from the
 *   *source* DOM before Defuddle runs. Defuddle's standardise step unwraps
 *   class/id hooks, so post-extraction selector matching is unreliable;
 *   filtering on the source DOM matches the Cheerio sanitiser's behaviour
 *   and the user's mental model.
 * - Updates `context.title` if Defuddle found a non-empty title and the
 *   previous extractor left it empty.
 * - Falls back to the original DOM if Defuddle returns empty output or removes
 *   substantially all text (see {@link minTextRetentionRatio}).
 */
export class HtmlDefuddleMiddleware implements ContentProcessorMiddleware {
  private readonly minTextRetentionRatio: number;

  constructor(options: HtmlDefuddleOptions = {}) {
    this.minTextRetentionRatio = options.minTextRetentionRatio ?? DEFAULT_MIN_RETENTION;
  }

  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    const $ = context.dom;
    if (!$) {
      logger.warn(
        `⏭️ Skipping ${this.constructor.name}: context.dom is missing. Ensure HtmlCheerioParserMiddleware runs before this.`,
      );
      await next();
      return;
    }

    try {
      const originalHtml = $.html();
      // Measure *visible* text, excluding script/style content. SPA pages
      // (Next.js, Nuxt, etc.) embed huge hydration payloads inside <script>
      // tags whose textContent inflates the body text length by orders of
      // magnitude, which would otherwise trip the retention-ratio fallback.
      const $bodyClone = cheerio.load(`<body>${$("body").html() ?? ""}</body>`);
      $bodyClone("script, style, noscript, template").remove();
      const textLengthBefore = $bodyClone("body").text().trim().length;

      const { document } = parseHTML(originalHtml);

      // Apply user-supplied excludeSelectors *before* Defuddle. Defuddle
      // standardises markup (e.g. unwrapping divs into <p>), which strips the
      // class/id hooks the user supplied — so post-extraction removal often
      // misses. Filtering on the source DOM matches the user's mental model
      // (same as the Cheerio sanitiser path).
      this.applyExcludePreDefuddle(document, context);

      // Defuddle's `standardize` step unwraps the language-bearing ancestor
      // divs that highlighters like Pygments/Sphinx and GitHub use (e.g.
      // `<div class="highlight-python3"><pre>...</pre></div>`). Push the
      // detected language onto the inner `<code>` as `class="language-X"` so
      // Defuddle preserves it and our Turndown rule can recover the fenced
      // code-block language.
      this.propagateLanguageHints(document);

      const result = await Defuddle(document, context.source, {
        // We do markdown conversion downstream (HtmlToMarkdownMiddleware), so
        // ask Defuddle for cleaned HTML, not markdown.
        markdown: false,
      });

      const cleanedContent = typeof result?.content === "string" ? result.content : "";

      // Build the cleaned Cheerio DOM *first*, then measure retention on the
      // post-sanitisation text. Doing the regex-strip-then-measure dance in
      // the other order let `<script>` *contents* (e.g. Next.js `__next_f`
      // hydration payloads) inflate the "kept" character count so the ratio
      // check passed, after which removing the script tags emptied the page.
      //
      // Note on H1 handling: Defuddle's standardize step deliberately drops
      // the first H1/H2 when it matches the extracted title (and converts
      // remaining H1s to H2s). The dropped headline text is preserved on
      // `context.title`, which the indexer attaches to every chunk as
      // metadata — so it's still searchable, just not duplicated inside the
      // chunk body. Defuddle exposes no granular flag to opt out of this
      // single behaviour (only the coarse `standardize: false` which would
      // also disable code-block / footnote standardisation).
      const wrappedHtml = `<!doctype html><html><head><title>${escapeHtml(result.title || context.title || "")}</title></head><body>${cleanedContent}</body></html>`;
      const cleaned$ = cheerio.load(wrappedHtml);

      // Strip dangerous / non-content tags. Defuddle can leak these (Next.js
      // hydration payloads being the worst offender) and they're never useful
      // in indexed markdown.
      cleaned$("script, style, noscript, iframe, svg, link, meta").remove();

      // Measure retention on the post-strip text so the ratio reflects what
      // actually survives into the chunked output.
      const cleanedText = cleaned$("body").text().trim();
      const ratio = textLengthBefore > 0 ? cleanedText.length / textLengthBefore : 0;

      if (!cleanedText || ratio < this.minTextRetentionRatio) {
        logger.warn(
          `⚠️  Defuddle retained ${cleanedText.length}/${textLengthBefore} chars (${(ratio * 100).toFixed(1)}%) for ${context.source}; falling back to original DOM with minimal sanitisation.`,
        );
        // Strip script/style/iframe defensively even on fallback — without
        // these the markdown converter renders hydration payloads (e.g.
        // Next.js __next_f) as multi-hundred-KB blobs.
        $("script, style, noscript, iframe, svg, link, meta").remove();
        await next();
        return;
      }

      context.dom = cleaned$;
      if (!context.title && result.title) {
        context.title = result.title;
      }

      logger.debug(
        `Defuddle reduced body text from ${textLengthBefore} to ${cleanedText.length} chars (${(ratio * 100).toFixed(1)}%) for ${context.source}`,
      );
    } catch (error) {
      logger.error(`❌ Defuddle extraction failed for ${context.source}: ${error}`);
      context.errors.push(
        error instanceof Error
          ? error
          : new Error(`Defuddle extraction failed: ${String(error)}`),
      );
    }

    await next();
  }

  /**
   * Normalise each `<pre>` so Defuddle preserves its language hint.
   *
   * Defuddle's standardise step strips `class="language-X"` unless `X` is one
   * of its allow-listed canonical language names (so `language-python3`,
   * `language-py`, etc. get dropped). It also unwraps highlighter ancestors
   * like `<div class="highlight-python3">`, losing that context entirely.
   *
   * However, Defuddle preserves `data-language` (and `data-lang`) verbatim and
   * promotes them to `class="language-X"` on the inner `<code>`. So this
   * pre-pass collects the language hint from `<pre>`, `<code>`, or nearby
   * ancestor classes and writes it back as `data-language` on `<pre>`. Our
   * Turndown rule in HtmlToMarkdownMiddleware then reads it off and emits a
   * fenced code block with the correct language.
   */
  private propagateLanguageHints(document: Document): void {
    const pres = document.querySelectorAll("pre");
    for (const pre of Array.from(pres)) {
      const existingCode = pre.querySelector("code");

      // Already set explicitly — leave alone.
      if (pre.getAttribute("data-language")) continue;

      let lang =
        detectLanguageFromClass(pre.getAttribute("class")) ||
        detectLanguageFromClass(existingCode?.getAttribute("class") ?? null);

      if (!lang) {
        let ancestor: Element | null = pre.parentElement;
        let depth = 0;
        while (ancestor && depth < 5) {
          const found = detectLanguageFromClass(ancestor.getAttribute("class"));
          if (found) {
            lang = found;
            break;
          }
          ancestor = ancestor.parentElement;
          depth++;
        }
      }

      if (!lang) continue;

      pre.setAttribute("data-language", lang);

      // Unwrap any highlighter wrapper divs around this <pre>. Defuddle's
      // standardise step rewrites the `<pre>` (stripping its attributes,
      // including our data-language) when it sees this wrapped structure.
      // Replacing the wrapper with the bare <pre> sidesteps that path.
      let wrapper: Element | null = pre.parentElement;
      let depth = 0;
      while (wrapper && depth < 5) {
        const cls = wrapper.getAttribute("class") ?? "";
        const isHighlightWrapper =
          /(?:^|\s)(?:highlight|highlight-source-[A-Za-z0-9_+-]+|highlight-[A-Za-z0-9_+-]+)(?:\s|$)/.test(
            cls,
          );
        if (
          isHighlightWrapper &&
          wrapper.children.length === 1 &&
          wrapper.parentElement
        ) {
          wrapper.parentElement.replaceChild(pre, wrapper);
          wrapper = pre.parentElement;
        } else {
          break;
        }
        depth++;
      }
    }
  }

  private applyExcludePreDefuddle(document: Document, context: MiddlewareContext): void {
    const selectors = context.options.excludeSelectors ?? [];
    if (selectors.length === 0) return;

    for (const selector of selectors) {
      try {
        const matches = document.querySelectorAll(selector);
        for (const node of Array.from(matches)) {
          const tag = node.tagName?.toLowerCase();
          if (tag === "html" || tag === "body") continue;
          node.remove();
        }
      } catch (selectorError) {
        logger.warn(
          `⚠️  Invalid excludeSelector "${selector}" before Defuddle: ${selectorError}`,
        );
        context.errors.push(
          new Error(`Invalid selector "${selector}": ${selectorError}`),
        );
      }
    }
  }
}

const LANGUAGE_CLASS_RE =
  /(?:^|\s)(?:highlight-source-|highlight-|language-)([A-Za-z0-9_+-]+)/;

function detectLanguageFromClass(className: string | null | undefined): string {
  if (!className) return "";
  const match = LANGUAGE_CLASS_RE.exec(className);
  if (!match) return "";
  const lang = match[1].toLowerCase();
  // Skip generic non-language tokens that show up under `highlight-` prefix.
  if (lang === "text" || lang === "highlighted" || lang === "wrap") return "";
  return lang;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
