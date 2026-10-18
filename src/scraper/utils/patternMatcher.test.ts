import { describe, expect, it } from "vitest";
import {
  matchesAnyHostPattern,
  matchesAnyPattern,
  patternToRegExp,
  shouldIncludeUrl,
} from "./patternMatcher";

describe("patternMatcher", () => {
  it("matchesAnyPattern applies glob and regex semantics", () => {
    const cases: Array<[path: string, pattern: string, expected: boolean]> = [
      // A pattern wrapped in slashes is a regex; anything else is a glob.
      ["foo123", "/foo.*/", true],
      ["fooxbar", "foo*bar", true],
      ["fooyyybar", "foo*bar", true],
      ["foo/bar", "foo*bar", false],
      ["foo/abc/bar", "foo/*/bar", true],
      ["foo/abc/bar", "/foo/.*/bar/", true],
      ["foo/abc/bar", "baz/*", false],
      // **/name matches the name at any depth, including the root.
      ["/README.md", "**/README.md", true],
      ["/foo", "**/foo", true],
      ["/docs/README.md", "**/README.md", true],
      ["/docs/foo", "**/foo", true],
      ["/project/docs/sub/README.md", "**/README.md", true],
      ["/project/docs/sub/foo", "**/foo", true],
      ["/CHANGELOG.md", "**/README.md", false],
      ["/docs/bar", "**/foo", false],
      // Directory and extension wildcards combined with **.
      ["/docs/api/v1/spec.json", "**/api/*/spec.json", true],
      ["/project/docs/api/v2/spec.json", "**/api/*/spec.json", true],
      ["/docs/api/spec.json", "**/api/*/spec.json", false], // missing version
      ["/docs/readme.md", "**/readme.*", true],
      ["/project/docs/readme.txt", "**/readme.*", true],
      ["/docs/changelog.md", "**/readme.*", false],
      // foo/** matches under a root-level foo; **/foo/** under foo anywhere.
      // Neither matches foo itself.
      ["/foo/bar", "foo/**", true],
      ["/foo/bar/baz", "foo/**", true],
      ["/foo", "foo/**", false],
      ["/other/foo/bar", "foo/**", false], // foo not at root
      ["/foo/bar", "**/foo/**", true],
      ["/docs/foo/bar", "**/foo/**", true],
      ["/project/docs/foo/baz", "**/foo/**", true],
      ["/foo", "**/foo/**", false],
      ["/docs/foo", "**/foo/**", false],
      ["/foobar/test", "**/foo/**", false], // foobar != foo
      ["/foo/", "**/foo/**", true],
      ["/a/foo/bar", "**/foo/**", true],
      ["/a/b/foo/c/d", "**/foo/**", true],
      ["/project/docs/foo/readme.md", "**/foo/**", true],
      // * stands for exactly one path segment.
      ["/docs/foo/readme.md", "*/foo/*", true],
      ["/project/docs/foo/readme.md", "*/foo/*", false], // too many levels before
      ["/project/docs/foo/readme.md", "*/*/foo/*", true],
      ["/project/docs/foo/readme.md", "**/foo/*", true],
      // A pattern needs no leading slash.
      ["/docs/file.md", "docs/file.md", true],
      ["/docs/file.md", "docs/*", true],
    ];

    for (const [path, pattern, expected] of cases) {
      expect
        .soft(matchesAnyPattern(path, [pattern]), `${path} ~ ${pattern}`)
        .toBe(expected);
    }
  });

  it("shouldIncludeUrl keeps a URL that any include pattern matches", () => {
    const dirPatterns = ["**/docs/**", "**/api/**", "**/foo/**"];
    const orPatterns = ["docs/*", "api/*", "**/README.md"];
    const docPatterns = [
      "**/README.md",
      "**/CHANGELOG.md",
      "**/package.json",
      "**/index.html",
    ];
    const mixedPatterns = ["**/README.md", "/api\\/v\\d+/", "docs/*"];
    const multiHost = ["/^https:\\/\\/(docs|api)\\.example\\.com\\/v\\d+\\//"];
    const cases: Array<[url: string, include: string[], expected: boolean]> = [
      ["https://example.com/foo", ["**/foo"], true],
      ["https://example.com/README.md", ["**/README.md"], true],
      ["https://example.com/docs/foo", ["**/foo"], true],
      ["https://example.com/docs/README.md", ["**/README.md"], true],
      ["https://example.com/docs/sub/foo", ["**/foo"], true],
      ["https://example.com/project/docs/sub/README.md", ["**/README.md"], true],
      ["https://example.com/bar", ["**/foo"], false],
      ["https://example.com/docs/CHANGELOG.md", ["**/README.md"], false],
      // file:// URLs match on the path and on the basename.
      ["file:///path/to/README.md", ["**/README.md"], true],
      ["file:///path/to/README.md", ["README.md"], true],
      ["file:///project/docs/foo", ["**/foo"], true],
      ["file:///project/docs/foo", ["foo"], true],
      // **/foo/** matches only what is under a foo directory.
      ["https://example.com/foo/index.html", ["**/foo/**"], true],
      ["https://example.com/src/foo/utils.js", ["**/foo/**"], true],
      ["https://example.com/project/lib/foo/main.ts", ["**/foo/**"], true],
      ["https://example.com/foo/file", ["**/foo/**"], true],
      ["https://example.com/foo", ["**/foo/**"], false], // the directory itself
      ["https://example.com/foobar", ["**/foo/**"], false],
      ["https://example.com/foo", ["**/foo"], true],
      ["https://example.com/foobar", ["**/foo*"], true],
      ["https://example.com/docs/guide.html", dirPatterns, true],
      ["https://example.com/project/docs/api.html", dirPatterns, true],
      ["https://example.com/v1/api/endpoints.json", dirPatterns, true],
      ["https://example.com/lib/foo/utils.js", dirPatterns, true],
      ["https://example.com/myapi.html", dirPatterns, false], // part of a file name
      ["https://example.com/foodocs.html", dirPatterns, false],
      ["https://example.com/docs", dirPatterns, false], // the directory itself
      ["https://example.com/project/api", dirPatterns, false],
      ["https://example.com/docs/file.md", ["docs/file.md"], true],
      // The query string is part of the matched path.
      ["https://example.com/docs/api?v=1", ["docs/*"], true],
      ["https://example.com/docs/api?v=1", ["docs/api*"], true], // * matches the query
      ["https://example.com/docs/api?v=1&format=json", ["docs/api*"], true],
      ["https://example.com/docs/api?v=1", ["**/api"], false], // the path ends with ?v=1
      ["https://example.com/docs/api", ["**/api"], true],
      ["https://example.com/docs/api?v=1", ["**/api*"], true],
      // Several patterns combine with OR.
      ["https://example.com/docs/guide", orPatterns, true],
      ["https://example.com/api/v1", orPatterns, true],
      ["https://example.com/project/README.md", orPatterns, true],
      ["https://example.com/other/file", orPatterns, false],
      ["https://example.com/README.md", docPatterns, true],
      ["https://example.com/package.json", docPatterns, true],
      ["https://example.com/docs/README.md", docPatterns, true],
      ["https://example.com/src/components/README.md", docPatterns, true],
      ["https://example.com/api/index.html", docPatterns, true],
      ["https://example.com/src/code.js", docPatterns, false],
      // Regex equivalents of **/foo.
      ["https://example.com/foo", ["/.*\\/foo$/"], true],
      ["https://example.com/docs/foo", ["/.*\\/foo$/"], true],
      ["https://example.com/docs/sub/foo", ["/.*\\/foo$/"], true],
      ["https://example.com/foo", ["/.*foo$/"], true],
      ["https://example.com/README.md", mixedPatterns, true], // glob
      ["https://example.com/api/v1", mixedPatterns, true], // regex
      ["https://example.com/docs/guide", mixedPatterns, true], // glob
      ["https://example.com/other/file", mixedPatterns, false],
      // One regex can allow some subdomains and not others.
      ["https://docs.example.com/v1/guide", multiHost, true],
      ["https://api.example.com/v2/ref", multiHost, true],
      ["https://blog.example.com/v1/post", multiHost, false],
      // Full URL, absolute path and relative path patterns all work.
      ["https://example.com/docs/guide", ["https://example.com/docs/**"], true],
      ["https://example.com/docs/guide", ["https://example.com/api/**"], false],
      ["https://example.com/docs/guide", ["/docs/**"], true],
      ["https://example.com/docs/guide", ["/api/**"], false],
      ["https://example.com/docs/guide", ["docs/**"], true],
      ["https://example.com/docs/guide", ["api/**"], false],
    ];

    for (const [url, include, expected] of cases) {
      expect
        .soft(shouldIncludeUrl(url, include), `${url} ~ ${include.join(", ")}`)
        .toBe(expected);
    }
  });

  it("shouldIncludeUrl drops a URL that any exclude pattern matches, even when included", () => {
    const cases: Array<{
      url: string;
      include?: string[];
      exclude: string[];
      expected: boolean;
    }> = [
      {
        url: "https://x.com/foo",
        include: ["foo*"],
        exclude: ["/foo/"],
        expected: false,
      },
      { url: "https://x.com/foo", include: ["foo*"], exclude: [], expected: true },
      { url: "https://x.com/foo", exclude: ["foo*"], expected: false },
      // Full URL, absolute path and relative path patterns all work.
      {
        url: "https://example.com/docs/v3/guide",
        exclude: ["https://example.com/docs/v3/**"],
        expected: false,
      },
      {
        url: "https://example.com/docs/v3/guide",
        exclude: ["https://example.com/docs/v2/**"],
        expected: true,
      },
      {
        url: "https://example.com/docs/v3/guide",
        exclude: ["/docs/v3/**"],
        expected: false,
      },
      {
        url: "https://example.com/docs/v3/guide",
        exclude: ["/docs/v2/**"],
        expected: true,
      },
      {
        url: "https://example.com/docs/v3/guide",
        exclude: ["docs/v3/**"],
        expected: false,
      },
      {
        url: "https://example.com/docs/v3/guide",
        exclude: ["docs/v2/**"],
        expected: true,
      },
      // A directory URL with a trailing slash is excluded too.
      { url: "https://example.com/docs/v3/", exclude: ["/docs/v3/**"], expected: false },
      {
        url: "https://example.com/docs/v3/",
        exclude: ["https://example.com/docs/v3/**"],
        expected: false,
      },
      { url: "https://example.com/docs/v3/", exclude: ["docs/v3/**"], expected: false },
      {
        url: "https://example.com/docs/v3/getting-started",
        exclude: ["https://example.com/docs/v3/**"],
        expected: false,
      },
      {
        url: "https://example.com/docs/v3/getting-started",
        exclude: ["/docs/v3/**"],
        expected: false,
      },
      {
        url: "https://example.com/docs/v3/getting-started",
        exclude: ["docs/v3/**"],
        expected: false,
      },
      // The domain of a full URL pattern must match; a regex can wildcard it.
      {
        url: "https://docs.example.com/guide",
        exclude: ["https://docs.example.com/**"],
        expected: false,
      },
      {
        url: "https://docs.example.com/guide",
        exclude: ["https://api.example.com/**"],
        expected: true,
      },
      {
        url: "https://docs.example.com/guide",
        exclude: ["/https:\\/\\/.*\\.example\\.com\\/.*/"],
        expected: false,
      },
      {
        url: "https://example.com/docs/archive/old.md",
        exclude: ["**/archive/**"],
        expected: false,
      },
      {
        url: "https://example.com/docs/archive/old.md",
        exclude: ["/docs/archive/**"],
        expected: false,
      },
      // file:// URLs also match on the basename.
      {
        url: "file:///path/to/CHANGELOG.md",
        exclude: ["**/CHANGELOG.md"],
        expected: false,
      },
    ];

    for (const { url, include, exclude, expected } of cases) {
      expect
        .soft(shouldIncludeUrl(url, include, exclude), `${url} !~ ${exclude.join(", ")}`)
        .toBe(expected);
    }
  });

  it("shouldIncludeUrl applies the default exclusions unless the caller gives an exclude list", () => {
    const cases: Array<{
      url: string;
      include?: string[];
      exclude?: string[];
      expected: boolean;
    }> = [
      // Default file exclusions.
      { url: "https://example.com/CHANGELOG.md", expected: false },
      { url: "https://example.com/changelog.md", expected: false },
      { url: "https://example.com/LICENSE", expected: false },
      { url: "https://example.com/LICENSE.md", expected: false },
      { url: "https://example.com/CODE_OF_CONDUCT.md", expected: false },
      // Default folder exclusions: archives, deprecated versions, translations.
      { url: "https://example.com/archive/old-docs.md", expected: false },
      { url: "https://example.com/archived/legacy.md", expected: false },
      { url: "https://example.com/old/stuff.md", expected: false },
      { url: "https://example.com/docs/old/readme.md", expected: false },
      { url: "https://example.com/deprecated/api.md", expected: false },
      { url: "https://example.com/legacy/guide.md", expected: false },
      { url: "https://example.com/previous/version.md", expected: false },
      { url: "https://example.com/i18n/zh-cn/guide.md", expected: false },
      { url: "https://example.com/i18n/es/tutorial.md", expected: false },
      { url: "https://example.com/i18n/fr/docs.md", expected: false },
      { url: "https://example.com/zh-cn/documentation.md", expected: false },
      { url: "https://example.com/zh-tw/guide.md", expected: false },
      // Ordinary documentation stays.
      { url: "https://example.com/docs/guide.md", expected: true },
      { url: "https://example.com/api/reference.md", expected: true },
      { url: "https://example.com/tutorials/basic.md", expected: true },
      { url: "https://example.com/README.md", expected: true },
      // file:// URLs are matched on their basename too.
      { url: "file:///docs/subdir/CHANGELOG.md", expected: false },
      { url: "file:///project/LICENSE", expected: false },
      { url: "file:///docs/README.md", expected: true },
      { url: "file:///guide/tutorial.md", expected: true },
      // Include patterns do not lift the defaults.
      { url: "https://example.com/docs/guide.md", include: ["docs/*"], expected: true },
      {
        url: "https://example.com/docs/CHANGELOG.md",
        include: ["docs/*"],
        expected: false,
      },
      { url: "https://example.com/other/guide.md", include: ["docs/*"], expected: false },
      // An explicit empty list turns the defaults off.
      { url: "https://example.com/CHANGELOG.md", exclude: [], expected: true },
      { url: "https://example.com/LICENSE", exclude: [], expected: true },
      // A caller's exclude list replaces the defaults.
      { url: "https://example.com/CHANGELOG.md", exclude: ["custom/*"], expected: true },
      { url: "https://example.com/custom/page", exclude: ["custom/*"], expected: false },
    ];

    for (const { url, include, exclude, expected } of cases) {
      expect
        .soft(
          shouldIncludeUrl(url, include, exclude),
          `${url} (exclude: ${JSON.stringify(exclude)})`,
        )
        .toBe(expected);
    }
  });

  it("should match regex patterns anchored on a full URL", () => {
    // Regression test: previously the matcher prepended `/` to inputs that
    // didn't start with one, which broke regex patterns anchored with
    // `^https://` because the URL became `/https://...` before testing.
    const pythonDocs = [
      "/^https:\\/\\/docs\\.python\\.org\\/3\\/(library|reference|howto)\\//",
    ];

    expect(
      shouldIncludeUrl("https://docs.python.org/3/library/functions.html", pythonDocs),
    ).toBe(true);
    expect(
      shouldIncludeUrl("https://docs.python.org/3/reference/datamodel.html", pythonDocs),
    ).toBe(true);
    expect(
      shouldIncludeUrl("https://docs.python.org/3/howto/regex.html", pythonDocs),
    ).toBe(true);

    // Other sections on the same host should not match.
    expect(
      shouldIncludeUrl("https://docs.python.org/3/tutorial/index.html", pythonDocs),
    ).toBe(false);
    // Other hosts should not match.
    expect(shouldIncludeUrl("https://example.com/3/library/foo.html", pythonDocs)).toBe(
      false,
    );
  });
});

describe("compiled pattern caching", () => {
  // Patterns are recompiled per URL without a cache, which dominates link
  // filtering: every discovered URL is tested against ~70 default exclusions,
  // twice. Caching must not change any verdict.
  it("returns the same compiled RegExp for a repeated pattern", () => {
    const first = patternToRegExp("**/*.test.*");
    const second = patternToRegExp("**/*.test.*");
    expect(second).toBe(first);
  });

  it("gives the same verdict on repeated evaluation", () => {
    const patterns = ["**/archive/**", "/\\.(ini|cfg)$/", "**/*.min.js"];
    const urls = [
      "https://example.com/docs/archive/old.html",
      "https://example.com/docs/guide.html",
      "https://example.com/app.min.js",
      "https://example.com/settings.ini",
    ];
    const first = urls.map((u) => matchesAnyPattern(u, patterns));
    const second = urls.map((u) => matchesAnyPattern(u, patterns));
    expect(second).toEqual(first);
    expect(first).toEqual([true, false, true, true]);
  });

  it("does not let a host-pattern match leak into URL matching", () => {
    // matchesAnyHostPattern lowercases its pattern before compiling; the cache
    // is keyed on the compiled string, so the two callers must not collide.
    expect(matchesAnyHostPattern("EXAMPLE.com", ["example.com"])).toBe(true);
    expect(matchesAnyPattern("/example.com", ["example.com"])).toBe(true);
  });
});
