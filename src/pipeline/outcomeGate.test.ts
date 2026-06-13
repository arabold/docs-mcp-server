import { describe, expect, it } from "vitest";
import { evaluateOutcome, type QualityGateConfig } from "./outcomeGate";
import { ScrapeErrorCode, ScrapeOutcome } from "./types";

const cfg: QualityGateConfig = { minDocs: 1, minInScopeRatio: 0.5 };

describe("evaluateOutcome", () => {
  it("classifies zero documents as empty", () => {
    const v = evaluateOutcome(
      { documentCount: 0, distinctUrls: 0, pagesScraped: 0 },
      cfg,
    );
    expect(v.outcome).toBe(ScrapeOutcome.EMPTY);
    expect(v.errorCode).toBe(ScrapeErrorCode.EMPTY_RESULT);
    expect(v.remediation).toMatch(/no .*content/i);
  });

  it("classifies below-threshold documents as thin", () => {
    const v = evaluateOutcome(
      { documentCount: 1, distinctUrls: 1, pagesScraped: 1 },
      { minDocs: 3, minInScopeRatio: 0.5 },
    );
    expect(v.outcome).toBe(ScrapeOutcome.THIN);
    expect(v.errorCode).toBe(ScrapeErrorCode.THIN_RESULT);
  });

  it("classifies failed expectTerms as degenerate/off-topic", () => {
    const v = evaluateOutcome(
      {
        documentCount: 50,
        distinctUrls: 40,
        pagesScraped: 40,
        expectTermsMatched: false,
      },
      cfg,
    );
    expect(v.outcome).toBe(ScrapeOutcome.DEGENERATE);
    expect(v.errorCode).toBe(ScrapeErrorCode.OFF_TOPIC);
  });

  it("classifies low in-scope ratio as degenerate/scope-drift", () => {
    const v = evaluateOutcome(
      { documentCount: 50, distinctUrls: 40, pagesScraped: 40, inScopeUrlRatio: 0.1 },
      cfg,
    );
    expect(v.outcome).toBe(ScrapeOutcome.DEGENERATE);
    expect(v.errorCode).toBe(ScrapeErrorCode.SCOPE_DRIFT);
  });

  it("passes healthy results as indexed", () => {
    const v = evaluateOutcome(
      {
        documentCount: 50,
        distinctUrls: 40,
        pagesScraped: 40,
        inScopeUrlRatio: 0.95,
        expectTermsMatched: true,
      },
      cfg,
    );
    expect(v.outcome).toBe(ScrapeOutcome.INDEXED);
    expect(v.errorCode).toBeUndefined();
  });
});
