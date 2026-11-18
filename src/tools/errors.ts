/** Error reported by a documentation tool to its caller. */
export class ToolError extends Error {
  /**
   * @param message - The error shown to the tool caller.
   * @param toolName - The tool that failed.
   * @param options - The underlying cause, when available.
   */
  constructor(
    message: string,
    public readonly toolName: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/**
 * Error thrown when tool input validation fails.
 * This indicates a client-side issue with the request parameters.
 */
export class ValidationError extends ToolError {}

/** Error reported when a fetched page yields no readable text. */
export class EmptyContentError extends ToolError {}
