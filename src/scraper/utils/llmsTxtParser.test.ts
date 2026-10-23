import { describe, expect, it } from "vitest";
import { isLlmsTxtUrl, parseLlmsTxt } from "./llmsTxtParser";

describe("parseLlmsTxt", () => {
  it("parses complete llms.txt content with sections and summary", () => {
    const result = parseLlmsTxt(`# Example Docs

> Official documentation for Example.
> Includes guides and API references.

## Guides

- [Getting Started](https://example.com/docs/start): Start here
- [Install](/docs/install)

## Optional

- [Changelog](https://example.com/changelog): Release notes
`);

    expect(result.projectName).toBe("Example Docs");
    expect(result.summary).toBe(
      "Official documentation for Example.\nIncludes guides and API references.",
    );
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({
      title: "Guides",
      optional: false,
    });
    expect(result.sections[1]).toMatchObject({
      title: "Optional",
      optional: true,
    });
    expect(result.links).toEqual([
      {
        title: "Getting Started",
        url: "https://example.com/docs/start",
        description: "Start here",
        optional: false,
        section: "Guides",
      },
      {
        title: "Install",
        url: "/docs/install",
        optional: false,
        section: "Guides",
      },
      {
        title: "Changelog",
        url: "https://example.com/changelog",
        description: "Release notes",
        optional: true,
        section: "Optional",
      },
    ]);
  });

  it("parses minimal llms.txt content", () => {
    const result = parseLlmsTxt(`# Minimal

- [Home](guide/intro)
`);

    expect(result.projectName).toBe("Minimal");
    expect(result.summary).toBeUndefined();
    expect(result.sections).toEqual([]);
    expect(result.links).toEqual([
      {
        title: "Home",
        url: "guide/intro",
        optional: false,
      },
    ]);
  });

  it("accepts content without an H1 heading, using the first line as the project name", () => {
    expect(parseLlmsTxt("No heading\n- [Link](https://example.com)")).toEqual({
      projectName: "No heading",
      sections: [],
      links: [{ title: "Link", url: "https://example.com", optional: false }],
    });
  });

  it("unwraps llms.txt that a browser rendered as plain text in a <pre>", () => {
    const rendered = `<html><head><meta name="color-scheme" content="light dark"></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;"># Project

&gt; A summary

- [Guide](https://example.com/guide?a=1&amp;b=2): The guide
</pre></body></html>`;

    const result = parseLlmsTxt(rendered);
    expect(result.projectName).toBe("Project");
    expect(result.summary).toBe("A summary");
    expect(result.links).toEqual([
      {
        title: "Guide",
        url: "https://example.com/guide?a=1&b=2",
        description: "The guide",
        optional: false,
      },
    ]);
  });

  it("returns an empty result for content that is not an llms.txt index", () => {
    const cases: Array<[label: string, content: string]> = [
      ["empty", ""],
      ["whitespace", "   \n\t\n"],
      ["no links", "# Project\n\nNo links"],
      ["HTML", "<!doctype html><html><body>nope</body></html>"],
      ["binary-like", "# Project\n\0\n- [Link](https://example.com)"],
      [
        // A soft-404 documentation page must not be mistaken for an llms.txt index.
        "HTML page whose body merely contains a <pre> code block",
        `<!doctype html>
<html><head><title>Docs</title></head><body>
<h1>Page not found</h1>
<p>Try one of these instead:</p>
<pre><code>
Quickstart
- [Guide](https://example.com/guide)
- [API](https://example.com/api)
</code></pre>
</body></html>`,
      ],
      [
        "HTML page that wraps a <pre> in another element",
        `<!doctype html><html><body><div class="content"><pre>Docs
- [Guide](https://example.com/guide)</pre></div></body></html>`,
      ],
      [
        // The shell renders no visible text of its own, so a text-only check would
        // mistake this soft-404 for a browser-rendered plain-text response.
        "empty SPA shell whose only text sits in a <pre>",
        `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><pre>Index
- [A](https://example.com/a)</pre><script>boot()</script></body></html>`,
      ],
      [
        "indented tag line as a headerless project name",
        "  <div>Page not found</div>\n- [Guide](https://example.com/g)\n",
      ],
      [
        "HTML page with several <pre> blocks",
        `<!doctype html><html><body>
<pre>- [One](https://example.com/one)</pre>
<pre>- [Two](https://example.com/two)</pre>
</body></html>`,
      ],
    ];

    for (const [label, content] of cases) {
      expect.soft(parseLlmsTxt(content), label).toEqual({ sections: [], links: [] });
    }
  });

  it("ignores multiple H1s and malformed links", () => {
    const result = parseLlmsTxt(`# First

# Second

- [Good](https://example.com/good)
- [Missing close paren](https://example.com/bad
- Missing brackets (https://example.com/bad)
`);

    expect(result.projectName).toBe("First");
    expect(result.links).toEqual([
      {
        title: "Good",
        url: "https://example.com/good",
        optional: false,
      },
    ]);
  });
});

describe("isLlmsTxtUrl", () => {
  it("matches URLs whose path basename is llms.txt", () => {
    const cases: Array<[url: string, expected: boolean]> = [
      ["https://example.com/llms.txt", true],
      ["https://example.com/docs/LLMS.TXT?cache=1#top", true],
      ["https://example.com/docs/llms.txt/child", false],
      ["https://example.com/docs/llms-full.txt", false],
      ["not a url", false],
    ];

    for (const [url, expected] of cases) {
      expect.soft(isLlmsTxtUrl(url), url).toBe(expected);
    }
  });
});
