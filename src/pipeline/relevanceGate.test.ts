import { describe, expect, it } from "vitest";
import { computeInScopeRatio, sampleExpectTermsMatch } from "./relevanceGate";

describe("relevanceGate", () => {
  it("computes the fraction of URLs under the requested root", () => {
    const ratio = computeInScopeRatio("https://github.com/o/r", [
      "https://github.com/o/r/blob/main/site/a.md",
      "https://github.com/o/r/blob/main/demos/x.js",
      "https://github.com/o/r/blob/main/demos/y.js",
    ]);
    expect(ratio).toBeCloseTo(1.0); // all under /o/r
  });

  it("aligns a github /tree/ root with /blob/ children (review F1: no false scope drift)", () => {
    // Real shape: root is a /tree/<branch>/<subpath>, children are /blob/<branch>/<path>.
    // A naive pathname-prefix compare would score 0 here; the ref-agnostic key must score 2/3.
    const ratio = computeInScopeRatio("https://github.com/o/r/tree/main/site/en", [
      "https://github.com/o/r/blob/main/site/en/a.md",
      "https://github.com/o/r/blob/main/site/en/sub/b.md",
      "https://github.com/o/r/blob/main/demos/x.js",
    ]);
    expect(ratio).toBeCloseTo(2 / 3); // 2 under site/en, demos out of scope
  });

  it("matches expectTerms against sampled chunk text (keyword path)", () => {
    const matched = sampleExpectTermsMatch(
      ["use generateContent to call the model", "unrelated text"],
      ["generateContent"],
    );
    expect(matched).toBe(true);
  });

  it("reports no match when terms are absent", () => {
    const matched = sampleExpectTermsMatch(
      ["list-it demo", "mood-food demo"],
      ["generateContent"],
    );
    expect(matched).toBe(false);
  });
});
