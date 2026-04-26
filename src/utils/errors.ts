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

class ChallengeError extends ScraperError {
  constructor(
    public readonly url: string,
    public readonly statusCode: number,
    public readonly challengeType: string,
  ) {
    super(
      `Challenge detected for ${url} (status: ${statusCode}, type: ${challengeType})`,
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

export {
  ChallengeError,
  InvalidUrlError,
  RedirectError,
  ScraperError,
  TlsCertificateError,
};
