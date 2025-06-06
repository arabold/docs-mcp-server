import { createJSDOM } from "../../utils/dom";
import { logger } from "../../utils/logger";
import type { FetchOptions, RawContent } from "../fetcher/types";
import { executeJsInSandbox } from "../utils/sandbox";
import type { ContentProcessorMiddleware, MiddlewareContext } from "./types";

/**
 * Middleware to parse HTML content and execute embedded JavaScript within a secure sandbox.
 * It uses the `executeJsInSandbox` utility (Node.js `vm` + JSDOM) to run scripts,
 * including fetching external scripts.
 *
 * This middleware updates `context.content` with the HTML *after* script execution.
 * Subsequent middleware (e.g., HtmlCheerioParserMiddleware) should handle parsing this content.
 *
 * @remarks
 * **WARNING:** This middleware provides a basic sandboxed JavaScript execution
 * environment but is **not suitable for general production use** on arbitrary
 * web pages. The JSDOM + Node VM environment lacks many Web APIs found in
 * real browsers (e.g., `MutationObserver`, `IntersectionObserver`, layout-dependent APIs)
 * and does not fully replicate browser script execution order (e.g., `async`, `defer`,
 * dynamic script loading). Use with caution and primarily for pages with
 * simple, known JavaScript dependencies. For robust rendering of complex pages,
 * consider using a headless browser solution.
 */
export class HtmlJsExecutorMiddleware implements ContentProcessorMiddleware {
  async process(context: MiddlewareContext, next: () => Promise<void>): Promise<void> {
    try {
      logger.debug(
        `Executing JavaScript in sandbox for HTML content from ${context.source}`,
      );

      // Define the callback for fetching external scripts
      const fetchScriptContentCallback = async (
        scriptUrl: string,
      ): Promise<string | null> => {
        if (!context.fetcher) {
          logger.warn(
            `⚠️  No fetcher available in context to fetch external script: ${scriptUrl}`,
          );
          return null;
        }
        try {
          logger.debug(`Fetching external script via context fetcher: ${scriptUrl}`);
          // Pass relevant options, especially the signal for cancellation
          const fetchOptions: FetchOptions = {
            signal: context.options?.signal, // Pass signal from context if available
            followRedirects: true, // Generally want to follow redirects for scripts
            // timeout: context.options?.fetchTimeout // Add if timeout is configurable at context level
          };
          const rawContent: RawContent = await context.fetcher.fetch(
            scriptUrl,
            fetchOptions,
          );

          // Optional: Check MIME type to be reasonably sure it's JavaScript
          const allowedMimeTypes = [
            "application/javascript",
            "text/javascript",
            "application/x-javascript",
          ];
          // Allow common JS types or be lenient if type is generic/unknown
          const mimeTypeLower = rawContent.mimeType.toLowerCase().split(";")[0].trim();
          if (
            !allowedMimeTypes.includes(mimeTypeLower) &&
            !["application/octet-stream", "unknown/unknown", ""].includes(mimeTypeLower) // Allow empty MIME type as well
          ) {
            logger.warn(
              `⏭️ Skipping execution of external script ${scriptUrl} due to unexpected MIME type: ${rawContent.mimeType}`,
            );
            context.errors.push(
              new Error(
                `Skipping execution of external script ${scriptUrl} due to unexpected MIME type: ${rawContent.mimeType}`,
              ),
            );
            return null;
          }

          // Convert content to string using provided encoding or default to utf-8
          const contentBuffer = Buffer.isBuffer(rawContent.content)
            ? rawContent.content
            : Buffer.from(rawContent.content);

          // Validate encoding before using it
          const validEncodings: BufferEncoding[] = [
            "ascii",
            "utf8",
            "utf-8",
            "utf16le",
            "ucs2",
            "ucs-2",
            "base64",
            "base64url",
            "latin1",
            "binary",
            "hex",
          ];
          const encoding =
            rawContent.encoding &&
            validEncodings.includes(rawContent.encoding.toLowerCase() as BufferEncoding)
              ? (rawContent.encoding.toLowerCase() as BufferEncoding)
              : "utf-8";

          return contentBuffer.toString(encoding);
        } catch (fetchError) {
          // fetcher.fetch is expected to throw on error (e.g., 404, network error)
          const message =
            fetchError instanceof Error ? fetchError.message : String(fetchError);
          logger.warn(`⚠️  Failed to fetch external script ${scriptUrl}: ${message}`); // Use warn for fetch failures like 404
          context.errors.push(
            new Error(`Failed to fetch external script ${scriptUrl}: ${message}`, {
              cause: fetchError,
            }),
          );
          return null; // Indicate failure to the sandbox runner
        }
      };

      // TODO: Plumb timeout options from context.options if available
      const sandboxOptions = {
        html: context.content,
        url: context.source,
        fetchScriptContent: fetchScriptContentCallback,
      };

      const result = await executeJsInSandbox(sandboxOptions);

      // Update context content with the HTML after script execution
      context.content = result.finalHtml;

      // DO NOT update context.dom here. The subsequent HtmlCheerioParserMiddleware will handle parsing.

      // Add any errors encountered during script execution to the context
      if (result.errors.length > 0) {
        context.errors.push(...result.errors);
        logger.warn(
          `⚠️  Encountered ${result.errors.length} error(s) during sandbox execution for ${context.source}`,
        );
      }

      logger.debug(
        `Sandbox execution completed for ${context.source}. Proceeding with updated content.`,
      );

      // Proceed to the next middleware with the modified context
      await next();
    } catch (error) {
      const baseMessage = `HtmlJsExecutorMiddleware failed for ${context.source}`;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const processingError = new Error(`${baseMessage}: ${errorMessage}`, {
        cause: error,
      });

      logger.error(`❌ ${processingError.message}`);
      context.errors.push(processingError);
      return;
    }
  }
}
