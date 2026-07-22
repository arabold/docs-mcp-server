import type { OutcomeVerdict } from "./outcomeGate";

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    if (cause?.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }
}

export class PipelineStateError extends PipelineError {}

/**
 * Raised when a scrape finished but failed a quality gate (empty/thin/degenerate).
 * Carries the full verdict (outcome, errorCode, remediation) for callers.
 */
export class QualityGateError extends Error {
  constructor(public readonly verdict: OutcomeVerdict) {
    super(verdict.remediation ?? `Quality gate failed: ${verdict.outcome}`);
    this.name = "QualityGateError";
  }
}

/**
 * Error indicating that an operation was cancelled.
 */
export class CancellationError extends PipelineError {
  constructor(message = "Operation cancelled") {
    super(message);
  }
}
