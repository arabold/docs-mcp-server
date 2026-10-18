import { describe, expect, it } from "vitest";
import {
  extractPrimaryDomain,
  normalizeUrl,
  stripMarkdownExtension,
  type UrlNormalizerOptions,
} from "./url";

describe("normalizeUrl", () => {
  it("drops the hash, trailing slash and index file and keeps the query and case by default", () => {
    const cases: Array<[url: string, expected: string]> = [
      ["https://example.com/api?version=1.0", "https://example.com/api?version=1.0"],
      [
        "https://example.com/api?v=1&format=json",
        "https://example.com/api?v=1&format=json",
      ],
      ["https://example.com/page#section", "https://example.com/page"],
      ["https://example.com/path?query=1#section", "https://example.com/path?query=1"],
      ["https://example.com/path#hash?query=1", "https://example.com/path"],
      ["https://example.com/page/", "https://example.com/page"],
      ["https://example.com/PAGE", "https://example.com/PAGE"],
      ["https://example.com/PATH/TO/PAGE", "https://example.com/PATH/TO/PAGE"],
      ["https://example.com/path/index.html", "https://example.com/path"],
      ["https://example.com/path/index.htm", "https://example.com/path"],
      ["https://example.com/path/index.asp", "https://example.com/path"],
      ["https://example.com/path/index.php", "https://example.com/path"],
      ["https://example.com/path/index.jsp", "https://example.com/path"],
      ["https://example.com/path/index.html?param=1", "https://example.com/path?param=1"],
      // "index" inside another word is not an index file
      ["https://example.com/reindex/page", "https://example.com/reindex/page"],
      // Index file and trailing slash are normalized; case is not. On a
      // case-sensitive filesystem `/Users/.../Docs` and `/users/.../docs` are
      // different directories, and folding them would merge two of them.
      ["file:///Users/username/Docs/Index.html", "file:///Users/username/Docs"],
      ["file:///Users/User%20Name/My%20Docs/", "file:///Users/User%20Name/My%20Docs"],
      // An invalid URL passes through unchanged
      ["not-a-url", "not-a-url"],
    ];

    for (const [url, expected] of cases) {
      expect.soft(normalizeUrl(url), url).toBe(expected);
    }
  });

  it("turns each normalization step on or off through its option", () => {
    const cases: Array<[url: string, options: UrlNormalizerOptions, expected: string]> = [
      [
        "https://example.com/page#section",
        { removeHash: false },
        "https://example.com/page#section",
      ],
      [
        "https://example.com/page/",
        { removeTrailingSlash: false },
        "https://example.com/page/",
      ],
      [
        "https://example.com/api?version=1.0",
        { removeQuery: true },
        "https://example.com/api",
      ],
      // A query on a file URL is rare but valid
      [
        "file:///path/to/file?query=1",
        { removeQuery: false },
        "file:///path/to/file?query=1",
      ],
      ["file:///path/to/file?query=1", { removeQuery: true }, "file:///path/to/file"],
      [
        "https://example.com/path/index.html",
        { removeIndex: false },
        "https://example.com/path/index.html",
      ],
    ];

    for (const [url, options, expected] of cases) {
      expect
        .soft(normalizeUrl(url, options), `${url} ${JSON.stringify(options)}`)
        .toBe(expected);
    }
  });

  it("keeps paths differing only in case distinct", () => {
    // The reason case folding was removed: this value is the crawl's dedup
    // key, so folding these together means the second page is never fetched
    // and nothing reports that it was dropped.
    expect(normalizeUrl("https://example.com/Guide")).not.toBe(
      normalizeUrl("https://example.com/guide"),
    );
  });

  it("still folds a trailing slash on a URL with no fragment", () => {
    // `removeHash: false` is how a hash-routed crawl keeps its route
    // fragments. Exempting the whole crawl from path normalization instead
    // left `/docs` and `/docs/` as two pages on exactly those sites.
    expect(normalizeUrl("https://example.com/docs/", { removeHash: false })).toBe(
      "https://example.com/docs",
    );
    expect(
      normalizeUrl("https://example.com/docs/index.html", { removeHash: false }),
    ).toBe("https://example.com/docs");
  });

  it("leaves the path alone in front of a preserved fragment", () => {
    // There the fragment names the route, so the path is part of its
    // spelling and trimming the slash invents a URL the site does not serve.
    expect(normalizeUrl("https://example.com/docs/#/guide", { removeHash: false })).toBe(
      "https://example.com/docs/#/guide",
    );
    expect(normalizeUrl("https://example.com/docs#/guide", { removeHash: false })).toBe(
      "https://example.com/docs#/guide",
    );
  });
});

describe("extractPrimaryDomain", () => {
  it("reduces a hostname to its registrable domain", () => {
    const cases: Array<[hostname: string, expected: string]> = [
      ["docs.python.org", "python.org"],
      ["api.github.com", "github.com"],
      ["www.example.com", "example.com"],
      ["subdomain.example.org", "example.org"],
      ["cdn.example.com", "example.com"],
      ["assets.cloudflare.com", "cloudflare.com"],
      ["python.org", "python.org"],
      ["github.com", "github.com"],
      ["example.net", "example.net"],
      // Multi-part public suffixes
      ["example.co.uk", "example.co.uk"],
      ["subdomain.example.co.uk", "example.co.uk"],
      ["test.com.au", "test.com.au"],
      ["subdomain.test.com.au", "test.com.au"],
      // For .gov.uk domains, the registrable domain is at the third level
      ["api.service.gov.uk", "api.service.gov.uk"],
      ["subdomain.api.service.gov.uk", "api.service.gov.uk"],
      ["example.de", "example.de"],
      ["www.example.fr", "example.fr"],
      ["subdomain.example.jp", "example.jp"],
      // GitHub Pages sites are separate registrable domains
      ["username.github.io", "username.github.io"],
      ["org.github.io", "org.github.io"],
      // Single-part hostnames and IP addresses stay as they are
      ["localhost", "localhost"],
      ["myserver", "myserver"],
      ["internal", "internal"],
      ["192.168.1.1", "192.168.1.1"],
      ["10.0.0.1", "10.0.0.1"],
      ["127.0.0.1", "127.0.0.1"],
      ["2001:db8::1", "2001:db8::1"],
      ["::1", "::1"],
      ["fe80::1", "fe80::1"],
      // Case is folded
      ["DOCS.PYTHON.ORG", "python.org"],
      ["API.GitHub.COM", "github.com"],
      // Empty and invalid input passes through
      ["", ""],
      [".", "."],
      ["..", ".."],
    ];

    for (const [hostname, expected] of cases) {
      expect.soft(extractPrimaryDomain(hostname), hostname).toBe(expected);
    }
  });
});

describe("stripMarkdownExtension", () => {
  it("strips a markdown extension to yield the canonical page URL", () => {
    const cases: Array<[url: string, expected: string]> = [
      ["https://react.dev/learn.md", "https://react.dev/learn"],
      ["https://vite.dev/guide/ssr.md", "https://vite.dev/guide/ssr"],
      // Any markdown extension the shared detector knows
      ["https://example.com/a/guide.markdown", "https://example.com/a/guide"],
      // Query and fragment are kept
      ["https://example.com/guide.md?v=2#intro", "https://example.com/guide?v=2#intro"],
    ];

    for (const [url, expected] of cases) {
      expect.soft(stripMarkdownExtension(url), url).toBe(expected);
    }
  });

  it("leaves every other URL unchanged", () => {
    const cases: string[] = [
      // The name is load-bearing: stripping any extension would rewrite
      // `report.pdf` to `report`, an identity nothing serves.
      "https://example.com/report.pdf",
      "https://example.com/page.tar.gz",
      // `.md` is Moldova's ccTLD; detection must see the path, not the host.
      "https://example.md/guide",
      "https://example.com/guide",
      "https://example.com/",
      // `/.md` has no canonical page to fold onto.
      "https://example.com/.md",
      // A dot in a directory segment is not an extension.
      "https://example.com/v1.0/guide",
      "not a url",
    ];

    for (const url of cases) {
      expect.soft(stripMarkdownExtension(url), url).toBe(url);
    }
  });
});
