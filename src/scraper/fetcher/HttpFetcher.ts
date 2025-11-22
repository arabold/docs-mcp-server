import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { CancellationError } from "../../pipeline/errors";
import { FETCHER_BASE_DELAY, FETCHER_MAX_RETRIES } from "../../utils/config";
import { ChallengeError, RedirectError, ScraperError } from "../../utils/errors";
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
 * Fetches content from remote sources using HTTP/HTTPS.
 */
export class HttpFetcher implements ContentFetcher {
  private readonly retryableStatusCodes = [
    408, // Request Timeout
    429, // Too Many Requests
    500, // Internal Server Error
    502, // Bad Gateway
    503, // Service Unavailable
    504, // Gateway Timeout
    525, // SSL Handshake Failed (Cloudflare specific)
  ];

  private readonly nonRetryableErrorCodes = [
    "ENOTFOUND", // DNS resolution failed - domain doesn't exist
    "ECONNREFUSED", // Connection refused - service not running
    "ENOENT", // No such file or directory
    "EACCES", // Permission denied
    "EINVAL", // Invalid argument
    "EMFILE", // Too many open files
    "ENFILE", // File table overflow
    "EPERM", // Operation not permitted
  ];

  private fingerprintGenerator: FingerprintGenerator;

  constructor() {
    this.fingerprintGenerator = new FingerprintGenerator();
  }

  canFetch(source: string): boolean {
    return source.startsWith("http://") || source.startsWith("https://");
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    const maxRetries = options?.maxRetries ?? FETCHER_MAX_RETRIES;
    const baseDelay = options?.retryDelay ?? FETCHER_BASE_DELAY;
    // Default to following redirects if not specified
    const followRedirects = options?.followRedirects ?? true;

    const result = await this.performFetch(
      source,
      options,
      maxRetries,
      baseDelay,
      followRedirects,
    );

    return result;
  }

  private async performFetch(
    source: string,
    options?: FetchOptions,
    maxRetries = FETCHER_MAX_RETRIES,
    baseDelay = FETCHER_BASE_DELAY,
    followRedirects = true,
  ): Promise<RawContent> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const fingerprint = this.fingerprintGenerator.generateHeaders();
        const headers: Record<string, string> = {
          ...fingerprint,
          ...options?.headers, // User-provided headers override generated ones
        };

        // Add If-None-Match header for conditional requests if ETag is provided
        if (options?.etag) {
          headers["If-None-Match"] = options.etag;
          logger.debug(
            `Conditional request for ${source} with If-None-Match: ${options.etag}`,
          );
        }

        const config: AxiosRequestConfig = {
          responseType: "arraybuffer",
          headers: {
            ...headers,
            // Override Accept-Encoding to exclude zstd which Axios doesn't handle automatically
            // This prevents servers from sending zstd-compressed content that would appear as binary garbage
            "Accept-Encoding": "gzip, deflate, br",
          },
          timeout: options?.timeout,
          signal: options?.signal, // Pass signal to axios
          // Axios follows redirects by default, we need to explicitly disable it if needed
          maxRedirects: followRedirects ? 5 : 0,
          decompress: true,
          // Allow 304 responses to be handled as successful responses
          validateStatus: (status) => {
            return (status >= 200 && status < 300) || status === 304;
          },
        };

        const response = await axios.get(source, config);

        // Handle 304 Not Modified responses for conditional requests
        if (response.status === 304) {
          logger.debug(`HTTP 304 Not Modified for ${source}`);
          return {
            content: Buffer.from(""),
            mimeType: "text/plain",
            source: source,
            status: FetchStatus.NOT_MODIFIED,
          } satisfies RawContent;
        }

        const contentTypeHeader = response.headers["content-type"];
        const { mimeType, charset } = MimeTypeUtils.parseContentType(contentTypeHeader);
        const contentEncoding = response.headers["content-encoding"];

        // Convert ArrayBuffer to Buffer properly
        let content: Buffer;
        if (response.data instanceof ArrayBuffer) {
          content = Buffer.from(response.data);
        } else if (Buffer.isBuffer(response.data)) {
          content = response.data;
        } else if (typeof response.data === "string") {
          content = Buffer.from(response.data, "utf-8");
        } else {
          // Fallback for other data types
          content = Buffer.from(response.data);
        }

        // Determine the final effective URL after redirects (if any)
        const finalUrl =
          // Node follow-redirects style
          response.request?.res?.responseUrl ||
          // Some adapters may expose directly
          response.request?.responseUrl ||
          // Fallback to axios recorded config URL
          response.config?.url ||
          source;

        // Extract ETag header for caching
        const etag = response.headers.etag || response.headers.ETag;
        if (etag) {
          logger.debug(`Received ETag for ${source}: ${etag}`);
        }

        // Extract Last-Modified header for caching
        const lastModified = response.headers["last-modified"];
        const lastModifiedISO = lastModified
          ? new Date(lastModified).toISOString()
          : undefined;

        return {
          content,
          mimeType,
          charset,
          encoding: contentEncoding,
          source: finalUrl,
          etag,
          lastModified: lastModifiedISO,
          status: FetchStatus.SUCCESS,
        } satisfies RawContent;
      } catch (error: unknown) {
        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const code = axiosError.code;

        // Handle abort/cancel: do not retry, throw CancellationError
        if (options?.signal?.aborted || code === "ERR_CANCELED") {
          // Throw with isError = false to indicate cancellation is not an error
          throw new CancellationError("HTTP fetch cancelled");
        }

        // Handle 404 Not Found - return special status for refresh operations
        if (status === 404) {
          logger.debug(`Resource not found (404): ${source}`);
          return {
            content: Buffer.from(""),
            mimeType: "text/plain",
            source: source,
            status: FetchStatus.NOT_FOUND,
          } satisfies RawContent;
        }

        // Handle redirect errors (status codes 301, 302, 303, 307, 308)
        if (!followRedirects && status && status >= 300 && status < 400) {
          const location = axiosError.response?.headers?.location;
          if (location) {
            throw new RedirectError(source, location, status);
          }
        }

        // Detect Cloudflare challenges
        if (status === 403) {
          const cfMitigated = axiosError.response?.headers?.["cf-mitigated"];
          const server = axiosError.response?.headers?.server;
          let responseBody = "";

          // Safely convert response data to string
          if (axiosError.response?.data) {
            try {
              if (typeof axiosError.response.data === "string") {
                responseBody = axiosError.response.data;
              } else if (Buffer.isBuffer(axiosError.response.data)) {
                responseBody = axiosError.response.data.toString("utf-8");
              } else if (axiosError.response.data instanceof ArrayBuffer) {
                responseBody = Buffer.from(axiosError.response.data).toString("utf-8");
              }
            } catch {
              // Ignore conversion errors
            }
          }

          // Check for various Cloudflare challenge indicators
          const isCloudflareChallenge =
            cfMitigated === "challenge" ||
            server === "cloudflare" ||
            responseBody.includes("Enable JavaScript and cookies to continue") ||
            responseBody.includes("Just a moment...") ||
            responseBody.includes("cf_chl_opt");

          if (isCloudflareChallenge) {
            throw new ChallengeError(source, status, "cloudflare");
          }
        }

        if (
          attempt < maxRetries &&
          (status === undefined || this.retryableStatusCodes.includes(status)) &&
          !this.nonRetryableErrorCodes.includes(code ?? "")
        ) {
          const delay = baseDelay * 2 ** attempt;
          logger.warn(
            `⚠️  Attempt ${attempt + 1}/${
              maxRetries + 1
            } failed for ${source} (Status: ${status}, Code: ${code}). Retrying in ${delay}ms...`,
          );
          await this.delay(delay);
          continue;
        }

        // Not a 5xx error or max retries reached
        throw new ScraperError(
          `Failed to fetch ${source} after ${
            attempt + 1
          } attempts: ${axiosError.message ?? "Unknown error"}`,
          true,
          error instanceof Error ? error : undefined,
        );
      }
    }
    throw new ScraperError(
      `Failed to fetch ${source} after ${maxRetries + 1} attempts`,
      true,
    );
  }
}
