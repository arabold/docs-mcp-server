import { describe, expect, it } from "vitest";
import { computeBaseDirectory, isInScope, isPathDescendant } from "./scope";

type ScopeCase = [base: string, target: string, expected: boolean];

/** Checks every case with one scope and reports each failing row. */
function expectScope(scope: Parameters<typeof isInScope>[2], cases: ScopeCase[]): void {
  for (const [base, target, expected] of cases) {
    expect
      .soft(isInScope(new URL(base), new URL(target), scope), `${base} -> ${target}`)
      .toBe(expected);
  }
}

describe("computeBaseDirectory", () => {
  it("returns the directory a start path scopes to", () => {
    const cases: Array<[pathname: string, expected: string]> = [
      ["", "/"],
      ["/", "/"],
      // A trailing slash is already a directory.
      ["/api/", "/api/"],
      ["/deep/nested/path/", "/deep/nested/path/"],
      // A non-index last segment gets a trailing slash.
      ["/api", "/api/"],
      ["/api/v1", "/api/v1/"],
      // index.<ext> and an extensionless index stand for their parent directory,
      // matched case-insensitively.
      ["/api/index.html", "/api/"],
      ["/api/index.htm", "/api/"],
      ["/Index.HTML", "/"],
      ["/api/Index.HTML", "/api/"],
      ["/api/INDEX.html", "/api/"],
      ["/api/index", "/api/"],
      ["/api/Index", "/api/"],
      // Only a segment named exactly "index" is an index.
      ["/api/indexes", "/api/indexes/"],
      ["/api/index2", "/api/index2/"],
      ["/api/indexing", "/api/indexing/"],
      // Regression: version-like paths are directories (the old dot heuristic
      // treated them as files).
      ["/v1.0", "/v1.0/"],
      ["/api/v2.0", "/api/v2.0/"],
      ["/v2.1", "/v2.1/"],
      // Regression: non-index file-like paths are directories too, so they scope
      // narrowly to themselves.
      ["/foo.html", "/foo.html/"],
      ["/changelog.md", "/changelog.md/"],
      ["/deep/path/file.md", "/deep/path/file.md/"],
    ];

    for (const [pathname, expected] of cases) {
      expect
        .soft(computeBaseDirectory(pathname), JSON.stringify(pathname))
        .toBe(expected);
    }
  });
});

describe("isPathDescendant", () => {
  it("accepts equal and nested paths and rejects siblings sharing a prefix", () => {
    const cases: Array<[parent: string, child: string, expected: boolean]> = [
      ["/api", "/api", true],
      ["/api/", "/api/", true],
      // The parent's trailing slash is normalized.
      ["/api", "/api/", true],
      ["/api/", "/api", true],
      ["/api", "/api/intro", true],
      ["/api/", "/api/intro/deep", true],
      ["/", "/", true],
      ["/", "/anything", true],
      ["/", "/foo/bar", true],
      ["", "/foo", true],
      ["/api", "/apix", false],
      ["/foo", "/foo~hash", false],
      ["/foo", "/foobar", false],
      ["/api", "/blog", false],
      ["/api/v1", "/api/v2", false],
    ];

    for (const [parent, child, expected] of cases) {
      expect
        .soft(isPathDescendant(parent, child), `${JSON.stringify(parent)} ⊇ ${child}`)
        .toBe(expected);
    }
  });
});

describe("isInScope", () => {
  it("subpages: accepts paths under the base directory on the same origin", () => {
    expectScope("subpages", [
      ["https://example.com/api/", "https://example.com/api/guides/intro", true],
      ["https://example.com/api/", "https://example.com/blog/post", false],
      ["https://example.com/api/", "https://api.example.com/api/intro", false],
      ["https://example.com/api/", "https://other.com/api/intro", false],
      // A different protocol is never in scope.
      ["https://example.com/api/", "http://example.com/api/intro", false],
      // A file base acts like its parent directory (index.html behavior).
      ["https://example.com/api/index.html", "https://example.com/api/child/page", true],
      ["https://example.com/api/index.html", "https://example.com/shared/page", false],
      // A path-only base without a trailing slash acts as a directory.
      ["https://example.com/api", "https://example.com/api/intro", true],
      // Paths compare case-sensitively.
      ["https://example.com/Api/", "https://example.com/api/intro", false],
      // Regression: /v1.0 scopes narrowly to /v1.0/.
      ["https://example.com/v1.0", "https://example.com/v1.0/intro", true],
      ["https://example.com/v1.0", "https://example.com/v2.0/intro", false],
      // Regression: /foo.html scopes to /foo.html/, which not even /foo.html is under.
      ["https://example.com/foo.html", "https://example.com/foo.html", false],
      ["https://example.com/foo.html", "https://example.com/other.html", false],
    ]);
  });

  it("hostname: accepts any path on the same host and port", () => {
    expectScope("hostname", [
      ["https://docs.example.com/api/", "https://docs.example.com/blog/post", true],
      ["https://docs.example.com/api/", "https://api.example.com/v1", false],
      ["https://example.com/api/", "http://example.com/api/intro", false],
      // Different ports are different hosts.
      ["https://example.com:8443/api/", "https://example.com:9000/api/intro", false],
      ["https://example.com:8443/api/", "https://example.com/api/intro", false],
      // The default port is normalized away.
      ["https://example.com/api/", "https://example.com:443/api/intro", true],
      // A trailing dot on either hostname is normalized.
      ["https://example.com./api/", "https://example.com/api/intro", true],
      ["https://example.com/api/", "https://example.com./api/intro", true],
    ]);
  });

  it("domain: accepts any host under the same registrable domain", () => {
    expectScope("domain", [
      ["https://docs.example.com/guide/", "https://api.example.com/endpoint", true],
      ["https://docs.example.com/guide/", "https://other.org/page", false],
      ["https://example.com/api/", "http://example.com/api/intro", false],
      // Multi-part public suffixes such as .co.uk.
      ["https://api.service.co.uk/docs", "https://www.service.co.uk/other", true],
      ["https://api.service.co.uk/docs", "https://different.co.uk/page", false],
      // GitHub Pages users are isolated from each other.
      ["https://user.github.io/repo", "https://user.github.io/other-repo", true],
      ["https://user.github.io/repo", "https://otheruser.github.io/repo", false],
      // gov.uk service-level domains.
      [
        "https://api.service.gov.uk/docs",
        "https://subdomain.api.service.gov.uk/assets",
        true,
      ],
      ["https://api.service.gov.uk/docs", "https://api.different.gov.uk/docs", false],
      ["https://api.service.gov.uk/docs", "https://cdn.service.gov.uk/assets", false],
      // IPv4 hosts compare verbatim.
      ["http://192.168.1.10/", "http://192.168.1.10/foo", true],
      ["http://192.168.1.10/", "http://192.168.1.20/foo", false],
      // localhost compares verbatim and ignores the port.
      ["http://localhost:3000/", "http://localhost:4000/", true],
      ["http://localhost:3000/", "http://otherhost:3000/", false],
      // A trailing dot on the hostname is normalized.
      ["https://docs.example.com./", "https://api.example.com/v1", true],
    ]);
  });
});
