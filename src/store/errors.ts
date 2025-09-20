/**
 * Base error class for all store-related errors.
 * Provides consistent error handling with optional cause tracking.
 */
class StoreError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(cause ? `${message} caused by ${cause}` : message);
    this.name = this.constructor.name;

    const causeError =
      cause instanceof Error ? cause : cause ? new Error(String(cause)) : undefined;
    if (causeError?.stack) {
      this.stack = causeError.stack;
    }
  }
}

/**
 * Error thrown when an embedding model's vector dimension exceeds the database's fixed dimension.
 * This occurs when trying to use a model that produces vectors larger than the database can store.
 */
class DimensionError extends StoreError {
  constructor(
    public readonly modelName: string,
    public readonly modelDimension: number,
    public readonly dbDimension: number,
  ) {
    super(
      `Model "${modelName}" produces ${modelDimension}-dimensional vectors, ` +
        `which exceeds the database's fixed dimension of ${dbDimension}. ` +
        `Please use a model with dimension ≤ ${dbDimension}.`,
    );
  }
}

/**
 * Error thrown when there's a problem with database connectivity or operations.
 */
class ConnectionError extends StoreError {}

/**
 * Error thrown when attempting to retrieve a document that doesn't exist.
 */
class DocumentNotFoundError extends StoreError {
  constructor(public readonly id: string) {
    super(`Document ${id} not found`);
  }
}

/**
 * Error thrown when required credentials for an embedding provider are missing.
 * This allows the system to gracefully degrade to FTS-only search when vectorization is unavailable.
 */
class MissingCredentialsError extends StoreError {
  constructor(
    public readonly provider: string,
    missingCredentials: string[],
  ) {
    super(
      `Missing credentials for ${provider} embedding provider. ` +
        `Required: ${missingCredentials.join(", ")}`,
    );
  }
}

export {
  StoreError,
  ConnectionError,
  DocumentNotFoundError,
  DimensionError,
  MissingCredentialsError,
};
