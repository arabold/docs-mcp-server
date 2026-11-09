import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CorpusSource, isCheckedOut, markCheckedOut } from "./corpus";

const SOURCE: CorpusSource = {
  library: "vite",
  repository: "https://github.com/vitejs/vite",
  revision: "a3001c5e3f4febb3099b097f4828ea567e1b253f",
  root: "docs",
  include: ["**/*.md"],
  license: "MIT",
};

describe("isCheckedOut", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "corpus-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reuses a checkout of the same source", () => {
    markCheckedOut(dir, SOURCE);

    expect(isCheckedOut(dir, SOURCE)).toBe(true);
  });

  it("checks out again when the file selection changes at the same revision", () => {
    markCheckedOut(dir, SOURCE);

    expect(isCheckedOut(dir, { ...SOURCE, include: ["**/*.md", "!blog/**"] })).toBe(
      false,
    );
    expect(isCheckedOut(dir, { ...SOURCE, root: "docs/guide" })).toBe(false);
  });

  it("does not reuse a directory without a completed checkout", () => {
    expect(isCheckedOut(dir, SOURCE)).toBe(false);
  });
});
