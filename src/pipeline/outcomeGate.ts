import { type JobOutcomeMetrics, ScrapeErrorCode, ScrapeOutcome } from "./types";

/** Tunable thresholds for the outcome gate. Conservative defaults avoid false positives. */
export interface QualityGateConfig {
  /** Minimum stored chunks to count as more than "thin". Default 1 (only 0 is blocked). */
  minDocs: number;
  /** Minimum fraction of indexed URLs under the requested root before SCOPE_DRIFT. */
  minInScopeRatio: number;
}

export const DEFAULT_QUALITY_GATE: QualityGateConfig = {
  minDocs: 1,
  minInScopeRatio: 0.25,
};

/** Verdict returned by the quality gate. */
export interface OutcomeVerdict {
  outcome: ScrapeOutcome;
  errorCode?: ScrapeErrorCode;
  /** Human-readable, caller-facing fix suggestion (only when failing). */
  remediation?: string;
}

/**
 * Classifies a finished scrape from its metrics. Pure: no I/O, fully unit-testable.
 * Order: empty -> thin -> relevance (off-topic before scope-drift) -> indexed.
 *
 * @param metrics - Counters collected when the job finished.
 * @param config - Tunable thresholds; defaults to {@link DEFAULT_QUALITY_GATE}.
 * @returns The classification verdict, including a typed error code and remediation when failing.
 */
export function evaluateOutcome(
  metrics: JobOutcomeMetrics,
  config: QualityGateConfig = DEFAULT_QUALITY_GATE,
): OutcomeVerdict {
  if (metrics.documentCount === 0) {
    return {
      outcome: ScrapeOutcome.EMPTY,
      errorCode: ScrapeErrorCode.EMPTY_RESULT,
      remediation:
        "The crawl finished but indexed no content. Check the URL is reachable, " +
        "renders without JavaScript gating, and is not a redirect/anti-bot wall.",
    };
  }

  if (metrics.documentCount < config.minDocs) {
    return {
      outcome: ScrapeOutcome.THIN,
      errorCode: ScrapeErrorCode.THIN_RESULT,
      remediation:
        `Only ${metrics.documentCount} chunk(s) indexed (min ${config.minDocs}). ` +
        "Widen maxPages/maxDepth or point at a richer docs root.",
    };
  }

  if (metrics.expectTermsMatched === false) {
    return {
      outcome: ScrapeOutcome.DEGENERATE,
      errorCode: ScrapeErrorCode.OFF_TOPIC,
      remediation:
        "Indexed content did not contain the expected terms. The source likely " +
        "covers a different topic than requested; pick a more specific URL.",
    };
  }

  if (
    metrics.inScopeUrlRatio !== undefined &&
    metrics.inScopeUrlRatio < config.minInScopeRatio
  ) {
    return {
      outcome: ScrapeOutcome.DEGENERATE,
      errorCode: ScrapeErrorCode.SCOPE_DRIFT,
      remediation:
        `Only ${Math.round(metrics.inScopeUrlRatio * 100)}% of indexed URLs are under ` +
        "the requested path. Narrow the URL or set denyPaths/includePatterns.",
    };
  }

  return { outcome: ScrapeOutcome.INDEXED };
}
