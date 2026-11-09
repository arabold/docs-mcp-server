import { describe, expect, it } from "vitest";
import {
  buildProtectedResourceMetadata,
  missingTokenChallenge,
  protectedResourceMetadataPaths,
} from "./protectedResourceMetadata";

describe("buildProtectedResourceMetadata", () => {
  it("advertises no scopes and names the resource after the server's title or name", () => {
    const cases = [
      {
        label: "title",
        server: { name: "acme-docs", title: "Acme Docs" },
        name: "Acme Docs",
      },
      {
        label: "name when it has no title",
        server: { name: "acme-docs" },
        name: "acme-docs",
      },
    ];

    for (const { label, server, name } of cases) {
      const document = buildProtectedResourceMetadata({
        mcpEndpointUrl: "https://example.com/mcp",
        issuerUrl: "https://auth.example.com",
        server,
      });

      expect.soft(document.resource_name, label).toBe(name);
      // Access is granted to any valid token
      expect.soft(document, label).not.toHaveProperty("scopes_supported");
    }
  });
});

describe("protectedResourceMetadataPaths", () => {
  it("serves one location, plus the RFC 9728 host-root one under a base path", () => {
    const cases = [
      { basePath: "", paths: ["/.well-known/oauth-protected-resource/mcp"] },
      {
        basePath: "/docs",
        paths: [
          "/.well-known/oauth-protected-resource/mcp",
          "/.well-known/oauth-protected-resource/docs/mcp",
        ],
      },
    ];

    for (const { basePath, paths } of cases) {
      expect
        .soft(protectedResourceMetadataPaths(basePath, "/mcp"), `base path "${basePath}"`)
        .toEqual(paths);
    }
  });
});

describe("missingTokenChallenge", () => {
  it("escapes quotes in the URL", () => {
    expect(missingTokenChallenge('https://x/"a')).toBe(
      'Bearer resource_metadata="https://x/\\"a"',
    );
  });
});
