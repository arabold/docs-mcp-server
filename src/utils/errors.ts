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

class NetworkError extends ScraperError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    cause?: Error,
  ) {
    super(message, true, cause);
  }
}

class RateLimitError extends ScraperError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message, true);
  }
}

class InvalidUrlError extends ScraperError {
  constructor(url: string, cause?: Error) {
    super(`Invalid URL: ${url}`, false, cause);
  }
}

class ParsingError extends ScraperError {
  constructor(message: string, cause?: Error) {
    super(`Failed to parse content: ${message}`, false, cause);
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

export {
  ScraperError,
  NetworkError,
  RateLimitError,
  InvalidUrlError,
  ParsingError,
  RedirectError,
  ChallengeError,
};
