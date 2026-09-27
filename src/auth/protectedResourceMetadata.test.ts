import { describe, expect, it } from "vitest";
import {
  buildProtectedResourceMetadata,
  missingTokenChallenge,
  protectedResourceMetadataPaths,
  protectedResourceMetadataUrl,
} from "./protectedResourceMetadata";

describe("buildProtectedResourceMetadata", () => {
  it("names the MCP endpoint as the resource and the issuer as its authorization server", () => {
    const document = buildProtectedResourceMetadata({
      mcpEndpointUrl: "https://example.com/docs/mcp",
      issuerUrl: "https://auth.example.com",
    });

    expect(document).toMatchObject({
      resource: "https://example.com/docs/mcp",
      authorization_servers: ["https://auth.example.com"],
      bearer_methods_supported: ["header"],
    });
  });

  it("advertises no scopes, since access is granted to any valid token", () => {
    const document = buildProtectedResourceMetadata({
      mcpEndpointUrl: "https://example.com/mcp",
      issuerUrl: "https://auth.example.com",
    });

    expect(document).not.toHaveProperty("scopes_supported");
  });
});

describe("protectedResourceMetadataPaths", () => {
  it("serves one location when there is no base path", () => {
    expect(protectedResourceMetadataPaths("")).toEqual([
      "/.well-known/oauth-protected-resource/mcp",
    ]);
  });

  it("adds the RFC 9728 host-root location for a base path", () => {
    expect(protectedResourceMetadataPaths("/docs")).toEqual([
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource/docs/mcp",
    ]);
  });
});

describe("protectedResourceMetadataUrl", () => {
  it("places the advertised document under the public URL's path", () => {
    expect(
      protectedResourceMetadataUrl({
        url: "https://example.com/docs",
        origin: "https://example.com",
        basePath: "/docs",
      }),
    ).toBe("https://example.com/docs/.well-known/oauth-protected-resource/mcp");
  });
});

describe("missingTokenChallenge", () => {
  it("points at the metadata without an error code", () => {
    const challenge = missingTokenChallenge(
      "https://example.com/docs/.well-known/oauth-protected-resource/mcp",
    );

    expect(challenge).toBe(
      'Bearer resource_metadata="https://example.com/docs/.well-known/oauth-protected-resource/mcp"',
    );
    expect(challenge).not.toContain("error=");
  });

  it("escapes quotes in the URL", () => {
    expect(missingTokenChallenge('https://x/"a')).toBe(
      'Bearer resource_metadata="https://x/\\"a"',
    );
  });
});
