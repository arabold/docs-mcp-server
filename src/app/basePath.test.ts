import { describe, expect, it } from "vitest";
import {
  injectBaseHref,
  isApiSocketPath,
  servesSpaShell,
  stripBasePath,
} from "./basePath";

describe("stripBasePath", () => {
  it("strips the base path only from URLs under it", () => {
    const cases: Array<{ url: string; basePath: string; expected: string }> = [
      { url: "/docs", basePath: "/docs", expected: "/" },
      { url: "/docs/", basePath: "/docs", expected: "/" },
      { url: "/docs/mcp", basePath: "/docs", expected: "/mcp" },
      { url: "/docs/api/health?x=1", basePath: "/docs", expected: "/api/health?x=1" },
      { url: "/docs?tab=jobs", basePath: "/docs", expected: "/?tab=jobs" },
      // Not under the base path: left alone
      { url: "/docs-old", basePath: "/docs", expected: "/docs-old" },
      { url: "/docsmcp", basePath: "/docs", expected: "/docsmcp" },
      { url: "/mcp", basePath: "/docs", expected: "/mcp" },
      { url: "/", basePath: "/docs", expected: "/" },
      // The identity without a base path
      { url: "/mcp?x=1", basePath: "", expected: "/mcp?x=1" },
    ];

    for (const { url, basePath, expected } of cases) {
      expect
        .soft(stripBasePath(url, basePath), `${url} under "${basePath}"`)
        .toBe(expected);
    }
  });
});

describe("injectBaseHref", () => {
  it("inserts an escaped base element as the first child of head", () => {
    const shell =
      '<!doctype html><html><head><meta charset="UTF-8" /><script src="./assets/index.js"></script></head><body></body></html>';
    // `expected` is a fragment of the output, or the whole output where `exact` is set
    const cases: Array<{
      label: string;
      html: string;
      basePath: string;
      expected: string;
      exact?: boolean;
    }> = [
      {
        label: "first child of head",
        html: shell,
        basePath: "/docs",
        expected: '<head><base href="/docs/"><meta charset="UTF-8" />',
      },
      {
        label: "the root without a base path, so deep links still resolve assets",
        html: shell,
        basePath: "",
        expected: '<head><base href="/">',
      },
      {
        label: "a head tag with attributes",
        html: '<html><head lang="en"><title>x</title></head></html>',
        basePath: "/a",
        expected: '<html><head lang="en"><base href="/a/"><title>x</title></head></html>',
        exact: true,
      },
      {
        label: "the base path escaped for the attribute",
        html: "<head></head>",
        basePath: '/a"b',
        expected: '<base href="/a&quot;b/">',
      },
    ];

    for (const { label, html, basePath, expected, exact } of cases) {
      const output = injectBaseHref(html, basePath);
      if (exact) expect.soft(output, label).toBe(expected);
      else expect.soft(output, label).toContain(expected);
    }
  });
});

describe("servesSpaShell", () => {
  it("serves the shell only for GET requests to client routes", () => {
    const cases: Array<{ method: string; url: string; expected: boolean }> = [
      { method: "GET", url: "/", expected: true },
      { method: "GET", url: "/libraries", expected: true },
      { method: "GET", url: "/libraries/react", expected: true },
      { method: "GET", url: "/jobs?x=1", expected: true },
      { method: "GET", url: "/sse", expected: false },
      { method: "GET", url: "/messages", expected: false },
      { method: "GET", url: "/mcp", expected: false },
      { method: "GET", url: "/mcp/anything", expected: false },
      { method: "GET", url: "/api", expected: false },
      { method: "GET", url: "/api/unknown", expected: false },
      { method: "GET", url: "/.well-known/unknown-document", expected: false },
      { method: "GET", url: "/assets/missing.js", expected: false },
      { method: "GET", url: "/oauth/authorize", expected: false },
      { method: "POST", url: "/libraries", expected: false },
    ];

    for (const { method, url, expected } of cases) {
      expect.soft(servesSpaShell(method, url), `${method} ${url}`).toBe(expected);
    }
  });
});

describe("isApiSocketPath", () => {
  it("accepts only the API path under the base path", () => {
    const cases: Array<{ url: string; basePath: string; expected: boolean }> = [
      { url: "/api", basePath: "", expected: true },
      { url: "/api?connectionParams=1", basePath: "", expected: true },
      { url: "/", basePath: "", expected: true },
      { url: "/docs/api", basePath: "/docs", expected: true },
      { url: "/api", basePath: "/docs", expected: true },
      { url: "/docs", basePath: "/docs", expected: true },
      { url: "/docs/", basePath: "/docs", expected: true },
      { url: "/mcp", basePath: "", expected: false },
      { url: "/sse", basePath: "", expected: false },
      { url: "/libraries", basePath: "", expected: false },
      { url: "/apix", basePath: "", expected: false },
      { url: "/docs/mcp", basePath: "/docs", expected: false },
      { url: "/mcp", basePath: "/docs", expected: false },
      {
        url: "/docs/.well-known/oauth-protected-resource/mcp",
        basePath: "/docs",
        expected: false,
      },
    ];

    for (const { url, basePath, expected } of cases) {
      expect
        .soft(isApiSocketPath(url, basePath), `${url} under "${basePath}"`)
        .toBe(expected);
    }
  });
});
