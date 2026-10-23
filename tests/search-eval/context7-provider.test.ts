/**
 * Tests for the Context7 provider's URL normalisation.
 *
 * Our IR metrics match result URLs against the dataset's qrels as strings, so a
 * provider that returns the right page under a different URL convention scores
 * zero for it. Each rule here exists because one library genuinely disagrees
 * with our qrels about how to spell a page.
 */

import { createRequire } from "node:module";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../../test/mock-server";

const require = createRequire(import.meta.url);
const { normalizeUrl, LIBRARY_MAP, fetchContext7 } = require("./context7-provider.cjs") as {
  normalizeUrl: (library: string, raw: string) => string;
  LIBRARY_MAP: Record<string, string>;
  fetchContext7: (libraryId: string, query: string) => Promise<unknown>;
};

describe("normalizeUrl — python version segment", () => {
  it("rewrites any versioned docs.python.org URL, and only that, to the /3/ alias our qrels use", () => {
    const cases: Array<[label: string, library: string, raw: string, expected: string]> = [
      [
        "versioned docs URL",
        "python",
        "https://docs.python.org/3.16/library/pathlib.html",
        "https://docs.python.org/3/library/pathlib.html",
      ],
      // Context7 retired /websites/python_3 and now ships per-version libraries,
      // so the version we point at is expected to move. The rule must not need
      // editing when it does.
      ...["3.9", "3.10", "3.14", "3.16"].map(
        (v): [string, string, string, string] => [
          `any version: ${v}`,
          "python",
          `https://docs.python.org/${v}/library/json.html`,
          "https://docs.python.org/3/library/json.html",
        ],
      ),
      [
        "already unversioned",
        "python",
        "https://docs.python.org/3/library/pathlib.html",
        "https://docs.python.org/3/library/pathlib.html",
      ],
      [
        "different host that looks similar",
        "python",
        "https://example.com/3.16/library/pathlib.html",
        "https://example.com/3.16/library/pathlib.html",
      ],
      [
        "other library",
        "react",
        "https://docs.python.org/3.16/library/pathlib.html",
        "https://docs.python.org/3.16/library/pathlib.html",
      ],
    ];

    for (const [label, library, raw, expected] of cases) {
      expect.soft(normalizeUrl(library, raw), label).toBe(expected);
    }
  });
});

describe("normalizeUrl — shared trimming and tailwindcss source paths", () => {
  it("trims URLs and maps tailwindcss docs sources to the rendered page", () => {
    const blog =
      "https://github.com/tailwindlabs/tailwindcss.com/blob/main/src/blog/tailwindcss-v2/index.mdx";
    const cases: Array<[label: string, library: string, raw: string, expected: string]> = [
      [
        "trailing slash stripped so fastapi URLs match the qrels",
        "fastapi",
        "https://fastapi.tiangolo.com/tutorial/path-params/",
        "https://fastapi.tiangolo.com/tutorial/path-params",
      ],
      ["query string dropped", "vite", "https://vite.dev/guide/?x=1", "https://vite.dev/guide"],
      [
        "tailwindcss docs .mdx source becomes the rendered page",
        "tailwindcss",
        "https://github.com/tailwindlabs/tailwindcss.com/blob/main/src/docs/flex.mdx",
        "https://tailwindcss.com/docs/flex",
      ],
      // Blog posts and layout files have no qrel counterpart; rewriting them
      // would invent a docs URL that does not exist.
      ["tailwindcss non-docs source left alone", "tailwindcss", blog, blog],
    ];

    for (const [label, library, raw, expected] of cases) {
      expect.soft(normalizeUrl(library, raw), label).toBe(expected);
    }
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

/**
 * The regression this provider exists to prevent: a response that is not a
 * usable result set must fail the run, not resolve to an empty one. A stale
 * library id scored zero on every query while reporting no errors, which read
 * as a 28% quality collapse on Context7's side.
 */
describe("fetchContext7 — responses that must not look like an empty result", () => {
  /** Answers this test's Context7 context requests with `status` and `body`. */
  function context7Replies(status: number, body: string | Record<string, unknown>): void {
    server.use(
      http.get("https://context7.com/api/v2/context", () =>
        typeof body === "string"
          ? new HttpResponse(body, { status })
          : HttpResponse.json(body, { status }),
      ),
    );
  }

  it("rejects every response that is not a usable result set", async () => {
    const cases: Array<
      [label: string, status: number, body: string | Record<string, unknown>, error: RegExp]
    > = [
      // What a retired library id actually returns. It parses as valid JSON and
      // carries no snippets, so accepting it yields zero results and exit code 0.
      [
        "202 for a library that is not finalized",
        202,
        {
          error: "library_not_finalized",
          message: "Library /websites/python_3 is still being processed.",
        },
        /HTTP 202/,
      ],
      [
        "429 quota response",
        429,
        { error: "Quota Exceeded", message: "Monthly quota exceeded." },
        /HTTP 429/,
      ],
      // The same trap by another route: a success status with a failure payload.
      [
        "200 whose body carries an error",
        200,
        { error: "internal", message: "something went wrong" },
        /returned error "internal"/,
      ],
      ["body that is not JSON", 200, "<html>gateway timeout</html>", /bad JSON/],
    ];

    for (const [label, status, body, error] of cases) {
      context7Replies(status, body);
      await expect.soft(fetchContext7("/websites/python_3", "pathlib"), label).rejects.toThrow(error);
    }
  });

  it("resolves a well-formed 200", async () => {
    context7Replies(200, { codeSnippets: [], infoSnippets: [] });

    await expect(
      fetchContext7("/websites/react_dev", "hooks"),
    ).resolves.toMatchObject({ codeSnippets: [], infoSnippets: [] });
  });
});
