/**
 * Tests for the Context7 provider's URL normalisation.
 *
 * Our IR metrics match result URLs against the dataset's qrels as strings, so a
 * provider that returns the right page under a different URL convention scores
 * zero for it. Each rule here exists because one library genuinely disagrees
 * with our qrels about how to spell a page.
 */

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { normalizeUrl, LIBRARY_MAP } = require("./context7-provider.cjs") as {
  normalizeUrl: (library: string, raw: string) => string;
  LIBRARY_MAP: Record<string, string>;
};

describe("normalizeUrl — python version segment", () => {
  it("rewrites a versioned docs URL to the /3/ alias our qrels use", () => {
    expect(normalizeUrl("python", "https://docs.python.org/3.16/library/pathlib.html")).toBe(
      "https://docs.python.org/3/library/pathlib.html",
    );
  });

  it("handles any version, not just the one mapped today", () => {
    // Context7 retired /websites/python_3 and now ships per-version libraries,
    // so the version we point at is expected to move. The rule must not need
    // editing when it does.
    for (const v of ["3.9", "3.10", "3.14", "3.16"]) {
      expect(normalizeUrl("python", `https://docs.python.org/${v}/library/json.html`)).toBe(
        "https://docs.python.org/3/library/json.html",
      );
    }
  });

  it("leaves an already-unversioned URL alone", () => {
    expect(normalizeUrl("python", "https://docs.python.org/3/library/pathlib.html")).toBe(
      "https://docs.python.org/3/library/pathlib.html",
    );
  });

  it("does not rewrite a different host that happens to look similar", () => {
    const url = "https://example.com/3.16/library/pathlib.html";
    expect(normalizeUrl("python", url)).toBe(url);
  });

  it("does not apply the python rule to other libraries", () => {
    const url = "https://docs.python.org/3.16/library/pathlib.html";
    expect(normalizeUrl("react", url)).toBe(url);
  });
});

describe("normalizeUrl — shared trimming", () => {
  it("strips a trailing slash so fastapi URLs match the qrels", () => {
    expect(normalizeUrl("fastapi", "https://fastapi.tiangolo.com/tutorial/path-params/")).toBe(
      "https://fastapi.tiangolo.com/tutorial/path-params",
    );
  });

  it("drops a query string", () => {
    expect(normalizeUrl("vite", "https://vite.dev/guide/?x=1")).toBe("https://vite.dev/guide");
  });
});

describe("normalizeUrl — tailwindcss source paths", () => {
  it("rewrites a docs .mdx source path to the rendered page", () => {
    expect(
      normalizeUrl(
        "tailwindcss",
        "https://github.com/tailwindlabs/tailwindcss.com/blob/main/src/docs/flex.mdx",
      ),
    ).toBe("https://tailwindcss.com/docs/flex");
  });

  it("leaves non-docs source paths alone", () => {
    // Blog posts and layout files have no qrel counterpart; rewriting them
    // would invent a docs URL that does not exist.
    const blog =
      "https://github.com/tailwindlabs/tailwindcss.com/blob/main/src/blog/tailwindcss-v2/index.mdx";
    expect(normalizeUrl("tailwindcss", blog)).toBe(blog);
  });
});

describe("LIBRARY_MAP", () => {
  it("covers every library the dataset references", () => {
    expect(Object.keys(LIBRARY_MAP).sort()).toEqual([
      "fastapi",
      "python",
      "react",
      "tailwindcss",
      "vite",
    ]);
  });

  it("no longer points python at the retired /websites/python_3", () => {
    // That id answers 202 `library_not_finalized` for every query, which the
    // provider used to swallow as an empty result set.
    expect(LIBRARY_MAP.python).not.toBe("/websites/python_3");
  });
});
