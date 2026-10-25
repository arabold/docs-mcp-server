import https from "node:https";
import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { CancellationError } from "../../pipeline/errors";
import { ScraperAccessPolicy } from "../../utils/accessPolicy";
import type { AppConfig } from "../../utils/config";
import {
  ChallengeError,
  HttpStatusError,
  RedirectError,
  ScraperError,
  TlsCertificateError,
} from "../../utils/errors";
import { logger } from "../../utils/logger";
import { MimeTypeUtils } from "../../utils/mimeTypeUtils";
import { detectChallengePage } from "./challenge";
import { FingerprintGenerator } from "./FingerprintGenerator";
import { HostBackoff, parseRetryAfter } from "./HostBackoff";
import { withMarkdownPreferredAccept, withoutConnectionHeaders } from "./headers";
import {
  type ContentFetcher,
  type FetchOptions,
  FetchStatus,
  type RawContent,
} from "./types";

/**
 * Maximum number of redirects to follow in a single fetch. Matches the legacy
 * axios default; kept here as a named constant because redirects are now
 * followed manually so every hop can be revalidated against the access policy.
 */
const MAX_REDIRECTS = 5;

/**
 * How much longer than other retries a throttled request waits when the server
 * names no delay. A retry after the usual second would most likely be
 * throttled again.
 */
const THROTTLE_DELAY_FACTOR = 5;

/**
 * Fetches content from remote sources using HTTP/HTTPS.
 *
 * A 429, or a 503 with `Retry-After`, pauses every request this fetcher sends
 * to that host (see {@link HostBackoff}).
 */
export class HttpFetcher implements ContentFetcher {
  private readonly maxRetriesDefault: number;
  /** Applied when the caller names no timeout; axios itself has no default. */
  private readonly timeoutDefaultMs: number;
  private readonly baseDelayDefaultMs: number;
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

  private readonly tlsCertificateErrorCodes = [
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ];

  private fingerprintGenerator: FingerprintGenerator;
  private readonly accessPolicy: ScraperAccessPolicy;
  private readonly hostBackoff: HostBackoff;

  /**
   * @param scraperConfig - Scraper settings, including the retry defaults.
   * @param hostBackoff - The per-host pause; pass one to share it with other
   * fetchers of the same crawl.
   */
  constructor(scraperConfig: AppConfig["scraper"], hostBackoff = new HostBackoff()) {
    this.maxRetriesDefault = scraperConfig.fetcher.maxRetries;
    this.baseDelayDefaultMs = scraperConfig.fetcher.baseDelayMs;
    this.timeoutDefaultMs = scraperConfig.fetcher.timeoutMs;
    this.fingerprintGenerator = new FingerprintGenerator();
    this.accessPolicy = new ScraperAccessPolicy(scraperConfig.security);
    this.hostBackoff = hostBackoff;
  }

  canFetch(source: string): boolean {
    return source.startsWith("http://") || source.startsWith("https://");
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isTlsCertificateError(code?: string): boolean {
    return code ? this.tlsCertificateErrorCodes.includes(code) : false;
  }

  async fetch(source: string, options?: FetchOptions): Promise<RawContent> {
    const maxRetries = options?.maxRetries ?? this.maxRetriesDefault;
    const baseDelay = options?.retryDelay ?? this.baseDelayDefaultMs;
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
    options: FetchOptions | undefined,
    maxRetries: number = this.maxRetriesDefault,
    baseDelay: number = this.baseDelayDefaultMs,
    followRedirects: boolean = true,
  ): Promise<RawContent> {
    await this.accessPolicy.assertNetworkUrlAllowed(source);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Outside the try so a throttle is recorded against the host of the hop
      // that answered, which a redirect may have changed.
      let currentUrl = source;
      try {
        let redirectCount = 0;

        while (true) {
          // Node's HTTP client manages the connection, so the fingerprint's
          // connection-level headers are left out.
          const fingerprint = withoutConnectionHeaders(
            this.fingerprintGenerator.generateHeaders(),
          );
          const headers = withMarkdownPreferredAccept(
            {
              ...fingerprint,
              ...options?.headers, // User-provided headers override generated ones
            },
            options?.headers,
          );

          // Add If-None-Match header for conditional requests if ETag is provided
          if (options?.etag) {
            headers["If-None-Match"] = options.etag;
            logger.debug(
              `Conditional request for ${source} with If-None-Match: ${options.etag}`,
            );
          }

          const config: AxiosRequestConfig = {
            // Streamed so the Content-Type can be inspected before any body bytes
            // are consumed, letting unprocessable responses be abandoned early.
            responseType: "stream",
            headers: {
              ...headers,
              // Override Accept-Encoding to exclude zstd which Axios doesn't handle automatically
              // This prevents servers from sending zstd-compressed content that would appear as binary garbage
              "Accept-Encoding": "gzip, deflate, br",
            },
            // Defaulted rather than passed through as undefined: axios treats
            // that as "wait forever", so a server that accepts the connection
            // and then stalls held the worker until the process died.
            timeout: options?.timeout ?? this.timeoutDefaultMs,
            signal: options?.signal, // Pass signal to axios
            // Redirects are handled manually so every target can be revalidated before connect.
            maxRedirects: 0,
            decompress: true,
            // Allow 304 responses to be handled as successful responses
            validateStatus: (status) => {
              return (status >= 200 && status < 400) || status === 304;
            },
          };

          if (this.accessPolicy.shouldAllowInvalidTls(currentUrl)) {
            config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
          }

          // A throttled retry waits here too, together with every other
          // request to the host.
          await this.hostBackoff.wait(currentUrl, options?.signal);
          const sentAt = Date.now();
          const response = await axios.get(currentUrl, config);
          this.hostBackoff.recover(currentUrl, sentAt);

          // Under `responseType: "stream"` a body that is never read pins its
          // socket: Node will not return a partially-consumed response to the
          // keep-alive pool. Only the success path consumes the stream, so every
          // other exit — 304, redirect, access-policy rejection, the content-type
          // gate — tears it down here rather than at each call site.
          let bodyConsumed = false;
          try {
            // 304 Not Modified is a conditional response, not a redirect. Handle
            // it before the 30x redirect branch so the missing Location header
            // does not trip the redirect check.
            if (response.status === 304) {
              logger.debug(`HTTP 304 Not Modified for ${currentUrl}`);
              return {
                content: Buffer.from(""),
                mimeType: "text/plain",
                source: currentUrl,
                status: FetchStatus.NOT_MODIFIED,
              } satisfies RawContent;
            }

            if (response.status >= 300 && response.status < 400) {
              const location = response.headers.location;
              if (!location) {
                throw new ScraperError(
                  `Redirect response for ${currentUrl} did not include a location header`,
                  false,
                );
              }

              if (!followRedirects) {
                throw new RedirectError(currentUrl, location, response.status);
              }

              if (redirectCount >= MAX_REDIRECTS) {
                throw new ScraperError(
                  `Too many redirects while fetching ${source}`,
                  false,
                );
              }

              const redirectUrl = new URL(location, currentUrl).href;
              await this.accessPolicy.assertNetworkUrlAllowed(redirectUrl);

              currentUrl = redirectUrl;
              redirectCount += 1;
              continue;
            }

            const contentTypeHeader = response.headers["content-type"];
            const { mimeType, charset } = MimeTypeUtils.parseContentType(
              typeof contentTypeHeader === "string" ? contentTypeHeader : undefined,
            );
            const rawContentEncoding = response.headers["content-encoding"];
            const contentEncoding =
              typeof rawContentEncoding === "string" ? rawContentEncoding : undefined;

            // Determine the final effective URL after redirects (if any)
            const finalUrl =
              // Node follow-redirects style
              response.request?.res?.responseUrl ||
              // Some adapters may expose directly
              response.request?.responseUrl ||
              // Fallback to axios recorded config URL
              response.config?.url ||
              currentUrl;

            await this.accessPolicy.assertNetworkUrlAllowed(finalUrl);

            // Content-type gate. Runs after redirect resolution and the access-policy
            // check for the final URL, and before the body is read, so a response no
            // pipeline can process costs headers rather than megabytes.
            if (options?.acceptsMimeType && !options.acceptsMimeType(mimeType)) {
              logger.debug(`Skipping ${finalUrl}: ${mimeType} is not processable`);
              return {
                content: Buffer.from(""),
                mimeType,
                charset,
                source: finalUrl,
                status: FetchStatus.SKIPPED,
              } satisfies RawContent;
            }

            // Extract ETag header for caching
            const etag = response.headers.etag || response.headers.ETag;
            if (etag) {
              logger.debug(`Received ETag for ${finalUrl}: ${etag}`);
            }

            // Extract Last-Modified header for caching
            const lastModified = response.headers["last-modified"];
            const lastModifiedISO = lastModified
              ? new Date(lastModified).toISOString()
              : undefined;

            const content = await readStreamToBuffer(response.data, options?.signal);
            bodyConsumed = true;

            // Some challenges answer with 200 rather than 403, so the status
            // check in the catch block below never sees them. Their page is
            // not the document and must not be returned as one.
            const challengeType = MimeTypeUtils.isHtml(mimeType)
              ? detectChallengePage(content)
              : null;
            if (challengeType) {
              throw new ChallengeError(source, response.status, challengeType);
            }

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
          } finally {
            if (!bodyConsumed) {
              destroyStream(response.data);
            }
          }
        }
      } catch (error: unknown) {
        if (error instanceof RedirectError || error instanceof ChallengeError) {
          throw error;
        }

        if (error instanceof ScraperError && !error.isRetryable) {
          throw error;
        }

        const axiosError = error as AxiosError;
        const status = axiosError.response?.status;
        const code = axiosError.code;
        const errorCause = error instanceof Error ? error : undefined;

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

        // The server asked the scraper to slow down. The pause covers the whole
        // host, and is recorded before the challenge check below so the browser
        // fallback waits it out as well.
        const retryAfterMs = parseRetryAfter(
          axiosError.response?.headers?.["retry-after"],
        );
        const throttleDelayMs =
          status === 429 || (status === 503 && retryAfterMs !== undefined)
            ? this.hostBackoff.throttle(
                currentUrl,
                baseDelay * THROTTLE_DELAY_FACTOR,
                retryAfterMs,
              )
            : undefined;

        // Detect Cloudflare challenges. Cloudflare also serves its challenge
        // with 429 once a client is rate limited; retrying that only extends
        // the block, so it goes to the browser at once like a 403 challenge.
        if (status === 403 || status === 429) {
          const cfMitigated = axiosError.response?.headers?.["cf-mitigated"];
          const server = axiosError.response?.headers?.server;
          let responseBody = "";

          // Read the error body so the content-based challenge markers below can
          // still be matched. Under `responseType: "stream"` this is a Readable,
          // so it has to be drained rather than cast.
          if (axiosError.response?.data) {
            try {
              responseBody = (
                await readStreamToBuffer(axiosError.response.data)
              ).toString("utf-8");
            } catch {
              // Ignore conversion errors
            }
          }

          // Check for various Cloudflare challenge indicators. A 429 from
          // Cloudflare is not a challenge on the server header alone: that is
          // also how a plain rate limit on a Cloudflare-fronted site looks.
          const isCloudflareChallenge =
            cfMitigated === "challenge" ||
            (status === 403 && server === "cloudflare") ||
            responseBody.includes("Enable JavaScript and cookies to continue") ||
            responseBody.includes("Just a moment...") ||
            responseBody.includes("cf_chl_opt");

          if (isCloudflareChallenge) {
            throw new ChallengeError(source, status, "cloudflare");
          }
        }

        // Axios rejects 4xx/5xx before the success path's try/finally is entered,
        // so the error body is a Readable nothing has consumed. Left open it pins
        // the socket, which matters most on the retry path: a new connection is
        // opened while the failed one is still held.
        destroyStream(axiosError.response?.data);

        if (this.isTlsCertificateError(code)) {
          throw new TlsCertificateError(source, code, errorCause);
        }

        if (
          attempt < maxRetries &&
          (status === undefined || this.retryableStatusCodes.includes(status)) &&
          !this.nonRetryableErrorCodes.includes(code ?? "")
        ) {
          const delay = throttleDelayMs ?? baseDelay * 2 ** attempt;
          logger.warn(
            `⚠️  Attempt ${attempt + 1}/${
              maxRetries + 1
            } failed for ${source} (Status: ${status}, Code: ${code}). Retrying in ${delay}ms...`,
          );
          // A throttled request waits out the host's pause at the top of the
          // next attempt instead.
          if (throttleDelayMs === undefined) {
            await this.delay(delay);
          }
          continue;
        }

        // Not a 5xx error or max retries reached
        const failureMessage = `Failed to fetch ${source} after ${
          attempt + 1
        } attempts: ${axiosError.message ?? "Unknown error"}`;
        throw status === undefined
          ? new ScraperError(failureMessage, true, errorCause)
          : new HttpStatusError(failureMessage, true, status, errorCause);
      }
    }
    throw new ScraperError(
      `Failed to fetch ${source} after ${maxRetries + 1} attempts`,
      true,
    );
  }
}

/**
 * Abandons a streamed response body without reading it.
 *
 * Used when the content-type gate rejects a response: the socket is torn down so
 * the remaining bytes are never transferred.
 *
 * @param stream The response body, which may be any shape axios returned.
 */
function destroyStream(stream: unknown): void {
  const candidate = stream as { destroy?: () => void } | null | undefined;
  if (candidate && typeof candidate.destroy === "function") {
    candidate.destroy();
  }
}

/**
 * Collects a streamed response body into a single Buffer.
 *
 * Axios yields a Node Readable under `responseType: "stream"`, already decompressed
 * when `decompress` is enabled. A body that is absent or not async-iterable — which
 * some error responses carry — reads as empty rather than throwing.
 *
 * @param stream The response body to read.
 * @param signal Optional abort signal; aborting destroys the stream.
 * @returns The complete body as a Buffer.
 */
async function readStreamToBuffer(
  stream: unknown,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (
    !stream ||
    typeof (stream as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function"
  ) {
    return Buffer.from("");
  }

  const chunks: Buffer[] = [];
  const onAbort = () => destroyStream(stream);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return Buffer.concat(chunks);
}
