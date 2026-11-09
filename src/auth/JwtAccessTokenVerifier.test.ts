import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildDiscoveryUrls } from "@modelcontextprotocol/client";
import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  authorizationServerMetadataUrls,
  INVALID_TOKEN_DESCRIPTION,
  JwtAccessTokenVerifier,
} from "./JwtAccessTokenVerifier";

const AUDIENCE = "https://example.com/docs/mcp";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
let issuerKeys: KeyPair;
let otherKeys: KeyPair;
let publicJwk: JWK;

beforeAll(async () => {
  issuerKeys = await generateKeyPair("RS256");
  otherKeys = await generateKeyPair("RS256");
  publicJwk = {
    ...(await exportJWK(issuerKeys.publicKey)),
    kid: "test-key",
    alg: "RS256",
  };
});

/**
 * A local authorization server: serves metadata at the given paths and the key
 * set at `/jwks`. `issuerPath` becomes part of the issuer identifier.
 */
async function startIssuer(options: {
  issuerPath?: string;
  metadataPaths?: (issuerPath: string) => string[];
  publishedIssuer?: (issuer: string) => string;
  jwksUri?: (origin: string) => string | undefined;
}) {
  const issuerPath = options.issuerPath ?? "";
  const routes = new Map<string, unknown>();
  const server: Server = createServer((request, response) => {
    const body = routes.get(request.url ?? "");
    if (body === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const issuer = `${origin}${issuerPath}`;
  const jwksUri = options.jwksUri ? options.jwksUri(origin) : `${origin}/jwks`;
  const metadata = {
    issuer: options.publishedIssuer ? options.publishedIssuer(issuer) : issuer,
    ...(jwksUri ? { jwks_uri: jwksUri } : {}),
  };
  const paths = options.metadataPaths
    ? options.metadataPaths(issuerPath)
    : ["/.well-known/oauth-authorization-server"];
  for (const path of paths) {
    routes.set(path, metadata);
  }
  routes.set("/jwks", { keys: [publicJwk] });
  return {
    issuer,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function signToken(
  claims: { iss: string; aud?: string; expiresIn?: string | number },
  keys: KeyPair = issuerKeys,
) {
  const jwt = new SignJWT({ scope: "openid profile", client_id: "mcp-client" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
    .setIssuer(claims.iss)
    .setSubject("user_123")
    .setIssuedAt();
  if (claims.aud) {
    jwt.setAudience(claims.aud);
  }
  jwt.setExpirationTime(claims.expiresIn ?? "5m");
  return jwt.sign(keys.privateKey);
}

async function expectRejection(
  promise: Promise<unknown>,
  code: OAuthErrorCode,
  label = String(code),
) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect.soft(error, label).toBeInstanceOf(OAuthError);
  expect.soft((error as OAuthError | undefined)?.code, label).toBe(code);
  if (code === OAuthErrorCode.InvalidToken) {
    // Every rejection reads the same, so the client learns nothing about why.
    expect
      .soft((error as OAuthError | undefined)?.message, label)
      .toBe(INVALID_TOKEN_DESCRIPTION);
  }
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length > 0) {
    await closers.pop()?.();
  }
});

async function issuerWithVerifier() {
  const issuer = await startIssuer({});
  closers.push(issuer.close);
  const verifier = await JwtAccessTokenVerifier.create({
    issuerUrl: issuer.issuer,
    audience: AUDIENCE,
  });
  return { issuer: issuer.issuer, verifier };
}

describe("authorizationServerMetadataUrls", () => {
  it("looks where the SDK's MCP clients look: RFC 8414, then OIDC, with the path inserted then appended", () => {
    const cases = [
      {
        issuer: "https://auth.example.com",
        urls: [
          "https://auth.example.com/.well-known/oauth-authorization-server",
          "https://auth.example.com/.well-known/openid-configuration",
        ],
      },
      {
        issuer: "https://auth.example.com/tenant1",
        urls: [
          "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
          "https://auth.example.com/.well-known/openid-configuration/tenant1",
          "https://auth.example.com/tenant1/.well-known/openid-configuration",
        ],
      },
    ];

    for (const { issuer, urls } of cases) {
      const actual = authorizationServerMetadataUrls(issuer);

      expect.soft(actual, issuer).toEqual(urls);
      expect
        .soft(actual, `${issuer} vs the SDK`)
        .toEqual(buildDiscoveryUrls(issuer).map(({ url }) => url.href));
    }
  });
});

describe("JwtAccessTokenVerifier.create", () => {
  it("discovers an issuer with a path through path insertion", async () => {
    const issuer = await startIssuer({
      issuerPath: "/tenant1",
      metadataPaths: (path) => [`/.well-known/oauth-authorization-server${path}`],
    });
    closers.push(issuer.close);

    const verifier = await JwtAccessTokenVerifier.create({
      issuerUrl: issuer.issuer,
      audience: AUDIENCE,
    });

    await expect(
      verifier.verifyAccessToken(await signToken({ iss: issuer.issuer, aud: AUDIENCE })),
    ).resolves.toMatchObject({ clientId: "mcp-client" });
  });

  it("falls back to OIDC discovery", async () => {
    const issuer = await startIssuer({
      metadataPaths: () => ["/.well-known/openid-configuration"],
    });
    closers.push(issuer.close);

    await expect(
      JwtAccessTokenVerifier.create({ issuerUrl: issuer.issuer, audience: AUDIENCE }),
    ).resolves.toBeInstanceOf(JwtAccessTokenVerifier);
  });

  it("fails when the issuer's metadata cannot be used", async () => {
    const cases: Array<{
      label: string;
      options: Parameters<typeof startIssuer>[0];
      issuerUrl?: (issuer: string) => string;
      error: RegExp;
    }> = [
      {
        label: "the configured issuer differs from the published one",
        options: {},
        issuerUrl: (issuer) => `${issuer}/`,
        error: /does not match the issuer the authorization server publishes/,
      },
      {
        label: "the metadata has no jwks_uri",
        options: { jwksUri: () => undefined },
        error: /no jwks_uri/,
      },
      {
        label: "no metadata document answers",
        options: { metadataPaths: () => [] },
        error: /Could not discover authorization server metadata/,
      },
    ];

    for (const { label, options, issuerUrl, error } of cases) {
      const issuer = await startIssuer(options);
      closers.push(issuer.close);

      await expect
        .soft(
          JwtAccessTokenVerifier.create({
            issuerUrl: issuerUrl ? issuerUrl(issuer.issuer) : issuer.issuer,
            audience: AUDIENCE,
          }),
          label,
        )
        .rejects.toThrow(error);
    }
  });
});

describe("JwtAccessTokenVerifier.verifyAccessToken", () => {
  it("accepts a token issued for this server", async () => {
    const { issuer, verifier } = await issuerWithVerifier();

    const info = await verifier.verifyAccessToken(
      await signToken({ iss: issuer, aud: AUDIENCE }),
    );

    expect(info).toMatchObject({
      clientId: "mcp-client",
      scopes: ["openid", "profile"],
    });
    expect(info.expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it("rejects every bad token the same way", async () => {
    const { issuer, verifier } = await issuerWithVerifier();
    const cases: Array<{ label: string; token: () => Promise<string> }> = [
      {
        label: "issued for another resource",
        token: () => signToken({ iss: issuer, aud: "https://other.example/mcp" }),
      },
      { label: "without an audience", token: () => signToken({ iss: issuer }) },
      {
        label: "from another issuer",
        token: () => signToken({ iss: "https://other-issuer.example", aud: AUDIENCE }),
      },
      {
        label: "expired",
        token: () =>
          signToken({
            iss: issuer,
            aud: AUDIENCE,
            expiresIn: Math.floor(Date.now() / 1000) - 60,
          }),
      },
      {
        label: "signed with a key the issuer does not publish",
        token: () => signToken({ iss: issuer, aud: AUDIENCE }, otherKeys),
      },
      { label: "opaque", token: async () => "oat_2s8Kq0opaqueTokenValue" },
    ];

    for (const { label, token } of cases) {
      await expectRejection(
        verifier.verifyAccessToken(await token()),
        OAuthErrorCode.InvalidToken,
        label,
      );
    }
  });

  it("reports unreachable signing keys as a server error", async () => {
    const issuer = await startIssuer({ jwksUri: () => "http://127.0.0.1:9/jwks" });
    closers.push(issuer.close);
    const verifier = await JwtAccessTokenVerifier.create({
      issuerUrl: issuer.issuer,
      audience: AUDIENCE,
    });

    await expectRejection(
      verifier.verifyAccessToken(await signToken({ iss: issuer.issuer, aud: AUDIENCE })),
      OAuthErrorCode.ServerError,
    );
  });
});
