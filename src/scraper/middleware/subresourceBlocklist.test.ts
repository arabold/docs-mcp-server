import { describe, expect, it } from "vitest";
import { isBlockedSubresource, SUBRESOURCE_BLOCKLIST } from "./subresourceBlocklist";

type Match = ReturnType<typeof isBlockedSubresource>;

describe("isBlockedSubresource", () => {
  it("matches a listed host and its subdomains, and nothing else", () => {
    const notBlocked: Match = { blocked: false };
    const cases: Array<[label: string, url: string, expected: Match]> = [
      [
        "exact host",
        "https://google-analytics.com/collect",
        { blocked: true, category: "Analytics" },
      ],
      [
        "subdomain",
        "https://www.google-analytics.com/analytics.js",
        { blocked: true, category: "Analytics" },
      ],
      [
        "deeper subdomain",
        "https://region1.events.hotjar.com/api/v2/client",
        { blocked: true, category: "Session Replay" },
      ],
      [
        "port on the request URL",
        "https://google-analytics.com:8443/collect",
        { blocked: true, category: "Analytics" },
      ],
      [
        "substring across the label boundary",
        "https://evil-google-analytics.com/x.js",
        notBlocked,
      ],
      ["unrelated host that ends similarly", "https://myanalytics.com/x.js", notBlocked],
      ["invalid URL", "not a url", notBlocked],
      ["empty URL", "", notBlocked],
      // Documented exclusion: blocking ad networks risks anti-adblock detection.
      ["ad network", "https://googleads.g.doubleclick.net/pagead/ads", notBlocked],
      [
        "ad network",
        "https://www.googlesyndication.com/pagead/js/adsbygoogle.js",
        notBlocked,
      ],
      ["ad network", "https://googleadservices.com/pagead/conversion.js", notBlocked],
      ["ad network", "https://www.googletagservices.com/tag/js/gpt.js", notBlocked],
      // Documented exclusion: pages legitimately fetch Mermaid/KaTeX/etc.
      ["CDN library", "https://unpkg.com/mermaid@11/dist/mermaid.min.js", notBlocked],
      [
        "CDN library",
        "https://cdn.jsdelivr.net/npm/katex@0.16.0/dist/katex.min.js",
        notBlocked,
      ],
      [
        "CDN library",
        "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
        notBlocked,
      ],
      ["CDN library", "https://cdn.skypack.dev/preact", notBlocked],
      ["CDN library", "https://esm.sh/react", notBlocked],
      [
        "first-party docs",
        "https://fastapi.tiangolo.com/search/search_index.json",
        notBlocked,
      ],
      ["first-party docs", "https://docs.python.org/3/library/typing.html", notBlocked],
      ["first-party docs", "https://example.com/script.js", notBlocked],
    ];

    for (const [label, url, expected] of cases) {
      expect.soft(isBlockedSubresource(url), `${label}: ${url}`).toEqual(expected);
    }
  });

  it("matches a path-prefix entry only under its prefix", () => {
    const cases: Array<[label: string, url: string, expected: Match]> = [
      [
        "YouTube embed runtime under the prefix",
        "https://www.youtube-nocookie.com/s/_/ytembeds/_/js/k=ytembeds.base.en_US.x/am=AAAAIA/d=1",
        { blocked: true, category: "Social Embed" },
      ],
      [
        "YouTube embed document path",
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        { blocked: false },
      ],
      [
        "sibling path on the same host",
        "https://www.youtube-nocookie.com/something/else.js",
        { blocked: false },
      ],
    ];

    for (const [label, url, expected] of cases) {
      expect.soft(isBlockedSubresource(url), label).toEqual(expected);
    }
  });
});

describe("SUBRESOURCE_BLOCKLIST", () => {
  it("never includes an advertising-network host", () => {
    // Sanity check that protects the documented anti-adblock posture.
    const forbiddenSubstrings = [
      "doubleclick",
      "googlesyndication",
      "googleadservices",
      "googletagservices",
    ];
    for (const entry of SUBRESOURCE_BLOCKLIST) {
      for (const banned of forbiddenSubstrings) {
        expect(entry.host).not.toContain(banned);
      }
    }
  });
});
