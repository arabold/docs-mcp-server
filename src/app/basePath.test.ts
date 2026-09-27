import { describe, expect, it } from "vitest";
import { injectBaseHref, servesSpaShell, stripBasePath } from "./basePath";

describe("stripBasePath", () => {
  it.each([
    ["/docs", "/"],
    ["/docs/", "/"],
    ["/docs/mcp", "/mcp"],
    ["/docs/api/health?x=1", "/api/health?x=1"],
    ["/docs?tab=jobs", "/?tab=jobs"],
  ])("strips the base path from %s", (url, expected) => {
    expect(stripBasePath(url, "/docs")).toBe(expected);
  });

  it.each(["/docs-old", "/docsmcp", "/mcp", "/"])(
    "leaves %s alone, since it is not under the base path",
    (url) => {
      expect(stripBasePath(url, "/docs")).toBe(url);
    },
  );

  it("is the identity without a base path", () => {
    expect(stripBasePath("/mcp?x=1", "")).toBe("/mcp?x=1");
  });
});

describe("injectBaseHref", () => {
  const shell =
    '<!doctype html><html><head><meta charset="UTF-8" /><script src="./assets/index.js"></script></head><body></body></html>';

  it("inserts the base element as the first child of head", () => {
    expect(injectBaseHref(shell, "/docs")).toContain(
      '<head><base href="/docs/"><meta charset="UTF-8" />',
    );
  });

  it("uses the root without a base path, so deep links still resolve assets", () => {
    expect(injectBaseHref(shell, "")).toContain('<head><base href="/">');
  });

  it("handles a head tag with attributes", () => {
    expect(
      injectBaseHref('<html><head lang="en"><title>x</title></head></html>', "/a"),
    ).toBe('<html><head lang="en"><base href="/a/"><title>x</title></head></html>');
  });

  it("escapes the base path for the attribute", () => {
    expect(injectBaseHref("<head></head>", '/a"b')).toContain('<base href="/a&quot;b/">');
  });
});

describe("servesSpaShell", () => {
  it.each(["/", "/libraries", "/libraries/react", "/jobs?x=1"])(
    "serves the shell for client route %s",
    (url) => {
      expect(servesSpaShell("GET", url)).toBe(true);
    },
  );

  it.each([
    "/sse",
    "/messages",
    "/mcp",
    "/mcp/anything",
    "/api",
    "/api/unknown",
    "/.well-known/unknown-document",
    "/assets/missing.js",
    "/oauth/authorize",
  ])("does not serve the shell for %s", (url) => {
    expect(servesSpaShell("GET", url)).toBe(false);
  });

  it("does not serve the shell for non-GET requests", () => {
    expect(servesSpaShell("POST", "/libraries")).toBe(false);
  });
});
