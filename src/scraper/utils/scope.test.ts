import { describe, expect, it } from "vitest";
import {
  computeBaseDirectory,
  isInScope,
  isPathDescendant,
  stripTrailingDot,
} from "./scope";

describe("computeBaseDirectory", () => {
  it("returns '/' for empty pathname", () => {
    expect(computeBaseDirectory("")).toBe("/");
  });

  it("returns '/' for root pathname", () => {
    expect(computeBaseDirectory("/")).toBe("/");
  });

  it("returns directory unchanged when pathname ends with slash", () => {
    expect(computeBaseDirectory("/api/")).toBe("/api/");
    expect(computeBaseDirectory("/deep/nested/path/")).toBe("/deep/nested/path/");
  });

  it("appends trailing slash for non-index last segment", () => {
    expect(computeBaseDirectory("/api")).toBe("/api/");
    expect(computeBaseDirectory("/api/v1")).toBe("/api/v1/");
  });

  it("treats /index.<ext> as directory index (uses parent directory)", () => {
    expect(computeBaseDirectory("/api/index.html")).toBe("/api/");
    expect(computeBaseDirectory("/api/index.htm")).toBe("/api/");
    expect(computeBaseDirectory("/Index.HTML")).toBe("/");
  });

  it("matches index file case-insensitively", () => {
    expect(computeBaseDirectory("/api/Index.HTML")).toBe("/api/");
    expect(computeBaseDirectory("/api/INDEX.html")).toBe("/api/");
  });

  it("treats extensionless /index as directory index", () => {
    expect(computeBaseDirectory("/api/index")).toBe("/api/");
    expect(computeBaseDirectory("/api/Index")).toBe("/api/");
  });

  it("does not match index-like names that are not exactly 'index'", () => {
    expect(computeBaseDirectory("/api/indexes")).toBe("/api/indexes/");
    expect(computeBaseDirectory("/api/index2")).toBe("/api/index2/");
    expect(computeBaseDirectory("/api/indexing")).toBe("/api/indexing/");
  });

  it("treats version-like paths as directories (the old dot-heuristic over-fire is fixed)", () => {
    expect(computeBaseDirectory("/v1.0")).toBe("/v1.0/");
    expect(computeBaseDirectory("/api/v2.0")).toBe("/api/v2.0/");
    expect(computeBaseDirectory("/v2.1")).toBe("/v2.1/");
  });

  it("treats non-index file-like paths as directories (narrow scope, just themselves)", () => {
    expect(computeBaseDirectory("/foo.html")).toBe("/foo.html/");
    expect(computeBaseDirectory("/changelog.md")).toBe("/changelog.md/");
    expect(computeBaseDirectory("/deep/path/file.md")).toBe("/deep/path/file.md/");
  });
});

describe("isPathDescendant", () => {
  it("returns true for equal paths", () => {
    expect(isPathDescendant("/api", "/api")).toBe(true);
    expect(isPathDescendant("/api/", "/api/")).toBe(true);
  });

  it("normalizes parent trailing slash when comparing", () => {
    expect(isPathDescendant("/api", "/api/")).toBe(true);
    expect(isPathDescendant("/api/", "/api")).toBe(true);
  });

  it("returns true when child is under parent directory", () => {
    expect(isPathDescendant("/api", "/api/intro")).toBe(true);
    expect(isPathDescendant("/api/", "/api/intro/deep")).toBe(true);
    expect(isPathDescendant("/", "/anything")).toBe(true);
  });

  it("returns false for sibling paths sharing a prefix", () => {
    expect(isPathDescendant("/api", "/apix")).toBe(false);
    expect(isPathDescendant("/foo", "/foo~hash")).toBe(false);
    expect(isPathDescendant("/foo", "/foobar")).toBe(false);
  });

  it("returns false for unrelated paths", () => {
    expect(isPathDescendant("/api", "/blog")).toBe(false);
    expect(isPathDescendant("/api/v1", "/api/v2")).toBe(false);
  });

  it("returns true with root as parent", () => {
    expect(isPathDescendant("/", "/")).toBe(true);
    expect(isPathDescendant("/", "/foo")).toBe(true);
    expect(isPathDescendant("/", "/foo/bar")).toBe(true);
  });

  it("handles empty parent path", () => {
    expect(isPathDescendant("", "/foo")).toBe(true);
  });
});

describe("stripTrailingDot", () => {
  it("returns hostname unchanged when no trailing dot", () => {
    expect(stripTrailingDot("example.com")).toBe("example.com");
    expect(stripTrailingDot("docs.example.com")).toBe("docs.example.com");
  });

  it("strips a single trailing dot", () => {
    expect(stripTrailingDot("example.com.")).toBe("example.com");
    expect(stripTrailingDot("docs.example.com.")).toBe("docs.example.com");
  });

  it("strips only the last dot, leaving inner dots intact", () => {
    expect(stripTrailingDot("a.b.c.")).toBe("a.b.c");
  });

  it("handles empty string", () => {
    expect(stripTrailingDot("")).toBe("");
  });
});

describe("isInScope - protocol equality", () => {
  it("rejects target with different protocol regardless of scope", () => {
    const base = new URL("https://example.com/api/");
    const target = new URL("http://example.com/api/intro");
    expect(isInScope(base, target, "subpages")).toBe(false);
    expect(isInScope(base, target, "hostname")).toBe(false);
    expect(isInScope(base, target, "domain")).toBe(false);
  });
});

describe("isInScope - subpages", () => {
  const baseDir = new URL("https://example.com/api/");
  const baseFile = new URL("https://example.com/api/index.html");

  it("descendant path is in scope from directory base", () => {
    expect(
      isInScope(baseDir, new URL("https://example.com/api/guides/intro"), "subpages"),
    ).toBe(true);
  });

  it("sibling path is not in scope", () => {
    expect(isInScope(baseDir, new URL("https://example.com/blog/post"), "subpages")).toBe(
      false,
    );
  });

  it("file base acts like its parent directory (preserves index.html behavior)", () => {
    expect(
      isInScope(baseFile, new URL("https://example.com/api/child/page"), "subpages"),
    ).toBe(true);
    expect(
      isInScope(baseFile, new URL("https://example.com/shared/page"), "subpages"),
    ).toBe(false);
  });

  it("path-only base (no trailing slash) acts as directory", () => {
    const base = new URL("https://example.com/api");
    expect(isInScope(base, new URL("https://example.com/api/intro"), "subpages")).toBe(
      true,
    );
  });

  it("path comparison is case-sensitive", () => {
    const base = new URL("https://example.com/Api/");
    expect(isInScope(base, new URL("https://example.com/api/intro"), "subpages")).toBe(
      false,
    );
  });

  it("/v1.0 start URL scopes narrowly to /v1.0/ (silent bug fixed)", () => {
    const base = new URL("https://example.com/v1.0");
    expect(isInScope(base, new URL("https://example.com/v1.0/intro"), "subpages")).toBe(
      true,
    );
    expect(isInScope(base, new URL("https://example.com/v2.0/intro"), "subpages")).toBe(
      false,
    );
  });

  it("/foo.html start URL scopes to itself only (silent bug fixed)", () => {
    const base = new URL("https://example.com/foo.html");
    // base directory becomes /foo.html/ — only descendants of that fictional path match
    expect(isInScope(base, new URL("https://example.com/foo.html"), "subpages")).toBe(
      false,
    ); // /foo.html does not start with /foo.html/
    expect(isInScope(base, new URL("https://example.com/other.html"), "subpages")).toBe(
      false,
    );
  });
});

describe("isInScope - hostname", () => {
  const base = new URL("https://docs.example.com/api/");

  it("same host all paths in scope", () => {
    expect(
      isInScope(base, new URL("https://docs.example.com/blog/post"), "hostname"),
    ).toBe(true);
  });

  it("different subdomain rejected", () => {
    expect(isInScope(base, new URL("https://api.example.com/v1"), "hostname")).toBe(
      false,
    );
  });

  it("different ports treated as different hosts", () => {
    const baseWithPort = new URL("https://example.com:8443/api/");
    expect(
      isInScope(baseWithPort, new URL("https://example.com:9000/api/intro"), "hostname"),
    ).toBe(false);
    expect(
      isInScope(baseWithPort, new URL("https://example.com/api/intro"), "hostname"),
    ).toBe(false);
  });

  it("default port is normalized away", () => {
    const baseNoPort = new URL("https://example.com/api/");
    expect(
      isInScope(baseNoPort, new URL("https://example.com:443/api/intro"), "hostname"),
    ).toBe(true);
  });

  it("trailing dot on either hostname is normalized", () => {
    const baseDot = new URL("https://example.com./api/");
    expect(isInScope(baseDot, new URL("https://example.com/api/intro"), "hostname")).toBe(
      true,
    );
    expect(
      isInScope(
        new URL("https://example.com/api/"),
        new URL("https://example.com./api/intro"),
        "hostname",
      ),
    ).toBe(true);
  });
});

describe("isInScope - domain", () => {
  const base = new URL("https://docs.example.com/guide/");

  it("different subdomain under same registrable domain is in scope", () => {
    expect(isInScope(base, new URL("https://api.example.com/endpoint"), "domain")).toBe(
      true,
    );
  });

  it("different primary domain rejected", () => {
    expect(isInScope(base, new URL("https://other.org/page"), "domain")).toBe(false);
  });

  it("handles complex TLDs (.co.uk)", () => {
    const baseCoUk = new URL("https://api.service.co.uk/docs");
    expect(
      isInScope(baseCoUk, new URL("https://www.service.co.uk/other"), "domain"),
    ).toBe(true);
    expect(isInScope(baseCoUk, new URL("https://different.co.uk/page"), "domain")).toBe(
      false,
    );
  });

  it("GitHub Pages users are isolated", () => {
    const baseGithub = new URL("https://user.github.io/repo");
    expect(
      isInScope(baseGithub, new URL("https://user.github.io/other-repo"), "domain"),
    ).toBe(true);
    expect(
      isInScope(baseGithub, new URL("https://otheruser.github.io/repo"), "domain"),
    ).toBe(false);
  });

  it("handles gov.uk service-level domains", () => {
    const baseGov = new URL("https://api.service.gov.uk/docs");
    expect(
      isInScope(
        baseGov,
        new URL("https://subdomain.api.service.gov.uk/assets"),
        "domain",
      ),
    ).toBe(true);
    expect(
      isInScope(baseGov, new URL("https://api.different.gov.uk/docs"), "domain"),
    ).toBe(false);
    expect(
      isInScope(baseGov, new URL("https://cdn.service.gov.uk/assets"), "domain"),
    ).toBe(false);
  });

  it("IPv4 hosts compare verbatim", () => {
    const base = new URL("http://192.168.1.10/");
    expect(isInScope(base, new URL("http://192.168.1.10/foo"), "domain")).toBe(true);
    expect(isInScope(base, new URL("http://192.168.1.20/foo"), "domain")).toBe(false);
  });

  it("localhost compares verbatim and ignores port", () => {
    const base = new URL("http://localhost:3000/");
    expect(isInScope(base, new URL("http://localhost:4000/"), "domain")).toBe(true);
    expect(isInScope(base, new URL("http://otherhost:3000/"), "domain")).toBe(false);
  });

  it("trailing dot on hostname is normalized for domain scope", () => {
    const baseDot = new URL("https://docs.example.com./");
    expect(isInScope(baseDot, new URL("https://api.example.com/v1"), "domain")).toBe(
      true,
    );
  });
});
