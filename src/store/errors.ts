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

/** Unicode general category Cc: C0 controls, DEL and C1 controls. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

function escapeControlCharacter(char: string): string {
  const code = char.charCodeAt(0);
  // C0 controls get JSON's readable escapes (\n, \t, \u001b); DEL and C1 get \uXXXX
  return code < 0x20
    ? JSON.stringify(char).slice(1, -1)
    : `\\u${code.toString(16).padStart(4, "0")}`;
}

/**
 * Escapes every control character (Unicode Cc) in text that an error message
 * repeats, such as a library name or version, so it cannot carry terminal
 * control sequences or forge log lines. Other characters are left as they are.
 */
export function escapeControlCharacters(text: string): string {
  return text.replace(CONTROL_CHARACTERS, escapeControlCharacter);
}

/**
 * Quotes a library name (or version) for an error message, with quotes,
 * backslashes and every control character escaped.
 */
export function quoteName(name: string): string {
  return escapeControlCharacters(JSON.stringify(name));
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
    let text = `Library ${escapeControlCharacters(library)} not found in store.`;
    if (similarLibraries.length > 0) {
      text += ` Did you mean: ${similarLibraries.map(escapeControlCharacters).join(", ")}?`;
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
    const versionText = version
      ? `Version ${escapeControlCharacters(version)}`
      : "Version";
    let text = `${versionText} for library ${escapeControlCharacters(library)} not found in store.`;
    if (availableVersions.length > 0) {
      text += ` Available versions: ${availableVersions.map(escapeControlCharacters).join(", ")}`;
    }
    super(text);
  }
}

/**
 * Error thrown when a request to create a new library finds that library already exists.
 * Raised only for an explicit "Add library" request.
 */
export class LibraryAlreadyExistsError extends StoreError {
  constructor(
    /** The existing library's stored display name. */
    public readonly library: string,
  ) {
    super(`Library ${quoteName(library)} already exists. Open it to add a version.`);
  }
}

/**
 * Error thrown when a scrape would clear an existing version without requesting replacement.
 */
export class VersionAlreadyExistsError extends StoreError {
  constructor(
    /** The library's stored display name. */
    public readonly library: string,
    /** The normalized version label; empty for unversioned documentation. */
    public readonly version: string,
  ) {
    const target = version
      ? `Version ${quoteName(version)} of library ${quoteName(library)}`
      : `Unversioned documentation for library ${quoteName(library)}`;
    super(
      `${target} already exists. To rebuild it, scrape again with --replace (CLI) or replace: true (MCP), or refresh it to update in place.`,
    );
  }
}

/**
 * Error thrown when a new library's name breaks a naming rule.
 */
export class InvalidLibraryNameError extends StoreError {
  constructor(
    /** The submitted name. */
    public readonly library: string,
    /** The broken rule, as returned by `describeLibraryNameProblem`. */
    public readonly reason: string,
  ) {
    super(`Invalid library name ${quoteName(library)}: ${reason}.`);
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
