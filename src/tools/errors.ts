export class ToolError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Error thrown when tool input validation fails.
 * This indicates a client-side issue with the request parameters.
 */
export class ValidationError extends ToolError {}
