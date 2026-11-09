import { describe, expect, it } from "vitest";
import { detectCharsetFromHtml, normalizeCharset, resolveCharset } from "./charset";

describe("detectCharsetFromHtml", () => {
  it("reads an HTML5 or HTML4 meta charset, case-insensitively", () => {
    const cases: Array<[label: string, html: string, expected: string | undefined]> = [
      [
        "HTML5 meta charset",
        '<html><head><meta charset="utf-8"><title>Test</title></head></html>',
        "utf-8",
      ],
      [
        "HTML5 meta charset, another value",
        '<html><head><meta charset="iso-8859-1"><title>Test</title></head></html>',
        "iso-8859-1",
      ],
      [
        "HTML4 http-equiv",
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>Test</title></head></html>',
        "utf-8",
      ],
      ["no charset", "<html><head><title>Test</title></head></html>", undefined],
      [
        "upper case",
        '<HTML><HEAD><META CHARSET="UTF-8"><TITLE>Test</TITLE></HEAD></HTML>',
        "utf-8",
      ],
    ];

    for (const [label, html, expected] of cases) {
      expect.soft(detectCharsetFromHtml(html), label).toBe(expected);
    }
  });
});

describe("resolveCharset", () => {
  it("prefers an HTML meta charset, then the HTTP charset, then UTF-8", () => {
    const noMeta = "<html><head><title>Test</title></head></html>";
    const cases: Array<
      [
        label: string,
        httpCharset: string | undefined,
        content: string | Buffer,
        mimeType: string,
        expected: string,
      ]
    > = [
      [
        "meta over header",
        "utf-8",
        Buffer.from('<meta charset="iso-8859-1"><title>Test</title>', "utf-8"),
        "text/html",
        "iso-8859-1",
      ],
      [
        "header without meta",
        "iso-8859-1",
        Buffer.from(noMeta, "utf-8"),
        "text/html",
        "iso-8859-1",
      ],
      ["neither", undefined, Buffer.from(noMeta, "utf-8"), "text/html", "utf-8"],
      [
        "header for non-HTML",
        "iso-8859-1",
        Buffer.from("Plain text content", "utf-8"),
        "text/plain",
        "iso-8859-1",
      ],
      [
        "string input",
        "utf-8",
        '<meta charset="windows-1252"><title>Test</title>',
        "text/html",
        "windows-1252",
      ],
    ];

    for (const [label, httpCharset, content, mimeType, expected] of cases) {
      expect.soft(resolveCharset(httpCharset, content, mimeType), label).toBe(expected);
    }
  });
});

describe("normalizeCharset", () => {
  it("maps aliases to decoder names and passes unknown names through", () => {
    const cases: Array<[charset: string, expected: string]> = [
      ["ISO-8859-1", "latin1"],
      ["windows-1252", "cp1252"],
      ["UTF8", "utf-8"],
      ["US-ASCII", "ascii"],
      ["unknown-charset", "unknown-charset"],
      // Case and surrounding whitespace do not matter.
      ["  UTF-8  ", "utf-8"],
      ["WINDOWS-1252", "cp1252"],
    ];

    for (const [charset, expected] of cases) {
      expect.soft(normalizeCharset(charset), JSON.stringify(charset)).toBe(expected);
    }
  });
});
