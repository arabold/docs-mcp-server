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

  it("returns an empty result for empty or invalid content", () => {
    expect(parseLlmsTxt("")).toEqual({ sections: [], links: [] });
    expect(parseLlmsTxt("No heading\n- [Link](https://example.com)")).toEqual({
      sections: [],
      links: [],
    });
    expect(parseLlmsTxt("# Project\n\nNo links")).toEqual({ sections: [], links: [] });
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
