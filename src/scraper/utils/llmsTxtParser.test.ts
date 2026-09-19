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

  it("supports links with and without descriptions", () => {
    const result = parseLlmsTxt(`# Links

- [Described](https://example.com/a): Useful page
- [Plain](https://example.com/b)
`);

    expect(result.links[0]?.description).toBe("Useful page");
    expect(result.links[1]?.description).toBeUndefined();
  });

  it("returns an empty result for empty or truly invalid content", () => {
    expect(parseLlmsTxt("")).toEqual({ sections: [], links: [] });
    expect(parseLlmsTxt("   \n\t\n")).toEqual({ sections: [], links: [] });
    expect(parseLlmsTxt("# Project\n\nNo links")).toEqual({ sections: [], links: [] });
  });

  it("accepts content without an H1 heading, using the first line as the project name", () => {
    expect(parseLlmsTxt("No heading\n- [Link](https://example.com)")).toEqual({
      projectName: "No heading",
      sections: [],
      links: [{ title: "Link", url: "https://example.com", optional: false }],
    });
  });

  it("returns an empty result for HTML and binary-like content", () => {
    expect(parseLlmsTxt("<!doctype html><html><body>nope</body></html>")).toEqual({
      sections: [],
      links: [],
    });
    expect(parseLlmsTxt("# Project\n\0\n- [Link](https://example.com)")).toEqual({
      sections: [],
      links: [],
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

  it("rejects an HTML page whose body merely contains a <pre> code block", () => {
    // A soft-404 documentation page must not be mistaken for an llms.txt index.
    const softNotFound = `<!doctype html>
<html><head><title>Docs</title></head><body>
<h1>Page not found</h1>
<p>Try one of these instead:</p>
<pre><code>
Quickstart
- [Guide](https://example.com/guide)
- [API](https://example.com/api)
</code></pre>
</body></html>`;

    expect(parseLlmsTxt(softNotFound)).toEqual({ sections: [], links: [] });
  });

  it("rejects an HTML page that merely wraps a <pre> in another element", () => {
    const wrapped = `<!doctype html><html><body><div class="content"><pre>Docs
- [Guide](https://example.com/guide)</pre></div></body></html>`;

    expect(parseLlmsTxt(wrapped)).toEqual({ sections: [], links: [] });
  });

  it("rejects an empty SPA shell whose only text sits in a <pre>", () => {
    // The shell renders no visible text of its own, so a text-only check would
    // mistake this soft-404 for a browser-rendered plain-text response.
    const shell = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><pre>Index
- [A](https://example.com/a)</pre><script>boot()</script></body></html>`;

    expect(parseLlmsTxt(shell)).toEqual({ sections: [], links: [] });
  });

  it("rejects an indented tag line as a headerless project name", () => {
    expect(
      parseLlmsTxt("  <div>Page not found</div>\n- [Guide](https://example.com/g)\n"),
    ).toEqual({ sections: [], links: [] });
  });

  it("rejects an HTML page containing multiple <pre> blocks", () => {
    const page = `<!doctype html><html><body>
<pre>- [One](https://example.com/one)</pre>
<pre>- [Two](https://example.com/two)</pre>
</body></html>`;

    expect(parseLlmsTxt(page)).toEqual({ sections: [], links: [] });
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
    expect(isLlmsTxtUrl("https://example.com/llms.txt")).toBe(true);
    expect(isLlmsTxtUrl("https://example.com/docs/LLMS.TXT?cache=1#top")).toBe(true);
  });

  it("does not match non-llms.txt URLs", () => {
    expect(isLlmsTxtUrl("https://example.com/docs/llms.txt/child")).toBe(false);
    expect(isLlmsTxtUrl("https://example.com/docs/llms-full.txt")).toBe(false);
    expect(isLlmsTxtUrl("not a url")).toBe(false);
  });
});
