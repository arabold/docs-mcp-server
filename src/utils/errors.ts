class ScraperError extends Error {
  constructor(
    message: string,
    public readonly isRetryable: boolean = false,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

class InvalidUrlError extends ScraperError {
  constructor(url: string, cause?: Error) {
    super(`Invalid URL: ${url}`, false, cause);
  }
}

class RedirectError extends ScraperError {
  constructor(
    public readonly originalUrl: string,
    public readonly redirectUrl: string,
    public readonly statusCode: number,
  ) {
    super(
      `Redirect detected from ${originalUrl} to ${redirectUrl} (status: ${statusCode})`,
      false,
    );
  }
}

/** A bot-protection challenge answered the request in place of the page. */
class ChallengeError extends ScraperError {
  constructor(
    public readonly url: string,
    public readonly statusCode: number,
    public readonly challengeType: string,
  ) {
    super(
      `Challenge detected for ${url} (status: ${statusCode}, type: ${challengeType}): the site answered with a bot check instead of the page`,
      false,
    );
  }
}

class TlsCertificateError extends ScraperError {
  constructor(
    public readonly url: string,
    public readonly code?: string,
    cause?: Error,
  ) {
    super(
      `TLS certificate validation failed for ${url}${
        code ? ` (${code})` : ""
      }. The remote site may have an incomplete or untrusted certificate chain.`,
      false,
      cause,
    );
  }
}

/** An HTTP fetch that failed with a response, carrying that response's status. */
class HttpStatusError extends ScraperError {
  constructor(
    message: string,
    isRetryable: boolean,
    public readonly statusCode: number,
    cause?: Error,
  ) {
    super(message, isRetryable, cause);
  }
}

class AccessPolicyError extends ScraperError {
  constructor(message: string) {
    super(message, false);
  }
}

/**
 * Returns the first line of a thrown value's message.
 *
 * Playwright's messages run on with call logs and install hints; the first line
 * names the failure.
 *
 * @param error The thrown value.
 * @returns The first line, or the whole message when that line is empty.
 */
function firstErrorLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] || message;
}

/** A page that had to be rendered in the browser could not be. */
class RenderError extends ScraperError {
  constructor(
    public readonly url: string,
    cause: Error,
  ) {
    super(`Playwright could not render ${url}: ${firstErrorLine(cause)}`, false, cause);
  }
}

export {
  AccessPolicyError,
  ChallengeError,
  firstErrorLine,
  HttpStatusError,
  InvalidUrlError,
  RedirectError,
  RenderError,
  ScraperError,
  TlsCertificateError,
};
