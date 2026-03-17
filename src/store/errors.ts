/**
 * Base error class for all store-related errors.
 * Provides consistent error handling with optional cause tracking.
 */
export class StoreError extends Error {
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
 * Error thrown when a requested library cannot be found in the store.
 * Includes suggestions for similar library names if available.
 */
export class LibraryNotFoundInStoreError extends StoreError {
  constructor(
    public readonly library: string,
    public readonly similarLibraries: string[] = [],
  ) {
    let text = `Library ${library} not found in store.`;
    if (similarLibraries.length > 0) {
      text += ` Did you mean: ${similarLibraries.join(", ")}?`;
    }
    super(text);
  }
}

/**
 * Error thrown when a specific version of a library cannot be found in the store.
 * Includes the list of available versions for better context.
 */
export class VersionNotFoundInStoreError extends StoreError {
  constructor(
    public readonly library: string,
    public readonly version: string,
    public readonly availableVersions: string[],
  ) {
    const versionText = version ? `Version ${version}` : "Version";
    let text = `${versionText} for library ${library} not found in store.`;
    if (availableVersions.length > 0) {
      text += ` Available versions: ${availableVersions.join(", ")}`;
    }
    super(text);
  }
}

/**
 * Error thrown when an embedding model's vector dimension exceeds the database's fixed dimension.
 * This occurs when trying to use a model that produces vectors larger than the database can store.
 */
export class DimensionError extends StoreError {
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
export class ConnectionError extends StoreError {}

/**
 * Error thrown when attempting to retrieve a document that doesn't exist.
 */
export class DocumentNotFoundError extends StoreError {
  constructor(public readonly id: string) {
    super(`Document ${id} not found`);
  }
}

/**
 * Error thrown when the configured embedding model or vector dimension differs from the
 * values stored in the database metadata. This indicates that existing vectors are
 * incompatible with the new configuration and must be invalidated before proceeding.
 *
 * The CLI layer catches this error to either prompt the user interactively (TTY) or
 * fail startup entirely (non-interactive/MCP/stdio mode).
 */
export class EmbeddingModelChangedError extends StoreError {
  constructor(
    public readonly previousModel: string,
    public readonly previousDimension: string,
    public readonly currentModel: string,
    public readonly currentDimension: string,
  ) {
    super(
      `Embedding model change detected:\n` +
        `  Previous: ${previousModel} (${previousDimension} dimensions)\n` +
        `  Current:  ${currentModel} (${currentDimension} dimensions)\n\n` +
        `All existing vectors are incompatible and must be invalidated.\n` +
        `To confirm this change, start the server interactively (with a TTY connected)\n` +
        `and follow the prompts.`,
    );
  }
}

/**
 * Error thrown when required credentials for an embedding provider are missing.
 * This allows the system to gracefully degrade to FTS-only search when vectorization is unavailable.
 */
export class MissingCredentialsError extends StoreError {
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
