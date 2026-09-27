/**
 * Verifies OAuth 2.0 access tokens for the MCP endpoint, which acts as a
 * resource server: a token is accepted only when it is a JWT signed with a key
 * the configured issuer publishes, carries that issuer's `iss`, names this
 * server in `aud`, and has not expired. There is no other path to access.
 */

import {
  type AuthInfo,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import { createRemoteJWKSet, errors, type JWTPayload, jwtVerify } from "jose";
import { logger } from "../utils/logger";

/**
 * The description every rejected token gets. The reason stays in the debug
 * log: telling the client which check failed would show an attacker which of
 * their tokens are close to valid.
 */
export const INVALID_TOKEN_DESCRIPTION = "The access token is invalid.";

/** How long one metadata discovery request may take before the next URL is tried. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/**
 * Metadata URLs to try for an issuer, in the order MCP clients use:
 * RFC 8414 with path insertion, OIDC Discovery with path insertion, then OIDC
 * Discovery with the path appended. Issuers without a path get the first two.
 * @param issuerUrl - The configured issuer identifier.
 * @returns Absolute URLs, most preferred first.
 */
export function authorizationServerMetadataUrls(issuerUrl: string): string[] {
  const url = new URL(issuerUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) {
    return [
      `${url.origin}/.well-known/oauth-authorization-server`,
      `${url.origin}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${url.origin}/.well-known/oauth-authorization-server${path}`,
    `${url.origin}/.well-known/openid-configuration${path}`,
    `${url.origin}${path}/.well-known/openid-configuration`,
  ];
}

async function fetchMetadata(url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return undefined;
    }
    const body: unknown = await response.json();
    return body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function stringClaim(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Whether a verification failure means the issuer's keys could not be
 * retrieved, as opposed to something wrong with the token itself.
 */
function isKeyRetrievalFailure(error: unknown): boolean {
  if (error instanceof errors.JWKSTimeout || error instanceof errors.JWKSInvalid) {
    return true;
  }
  if (!(error instanceof errors.JOSEError)) {
    // Network failures from fetching the key set surface as plain errors.
    return true;
  }
  return error.code === "ERR_JOSE_GENERIC" && /JSON Web Key Set/i.test(error.message);
}

/** Verifies JWT access tokens against the configured issuer and audience. */
export class JwtAccessTokenVerifier implements OAuthTokenVerifier {
  private constructor(
    private readonly issuer: string,
    private readonly audience: string,
    private readonly keys: ReturnType<typeof createRemoteJWKSet>,
  ) {}

  /**
   * Discover the issuer's metadata and prepare its key set.
   *
   * @param options.issuerUrl - The configured issuer. It must be identical to the
   *   `issuer` the authorization server publishes.
   * @param options.audience - The audience a token must carry.
   * @returns The verifier.
   * @throws Error when no metadata document answers, when its `issuer` differs
   *   from `issuerUrl`, or when it has no `jwks_uri`.
   */
  static async create(options: {
    issuerUrl: string;
    audience: string;
  }): Promise<JwtAccessTokenVerifier> {
    const urls = authorizationServerMetadataUrls(options.issuerUrl);
    let metadata: Record<string, unknown> | undefined;
    for (const url of urls) {
      metadata = await fetchMetadata(url);
      if (metadata) {
        break;
      }
    }
    if (!metadata) {
      throw new Error(
        `Could not discover authorization server metadata for auth.issuerUrl "${options.issuerUrl}". Tried: ${urls.join(", ")}`,
      );
    }
    if (metadata.issuer !== options.issuerUrl) {
      throw new Error(
        `auth.issuerUrl "${options.issuerUrl}" does not match the issuer the authorization server publishes, "${String(metadata.issuer)}". Set auth.issuerUrl to exactly that value.`,
      );
    }
    if (typeof metadata.jwks_uri !== "string") {
      throw new Error(
        `The authorization server metadata for "${options.issuerUrl}" has no jwks_uri. Only JWT access tokens are supported.`,
      );
    }
    return new JwtAccessTokenVerifier(
      options.issuerUrl,
      options.audience,
      createRemoteJWKSet(new URL(metadata.jwks_uri)),
    );
  }

  /**
   * Verify an access token.
   * @param token - The raw bearer token.
   * @returns What the token grants.
   * @throws OAuthError(InvalidToken) when the token itself is not acceptable;
   *   OAuthError(ServerError) when the issuer's keys cannot be retrieved.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: this.audience,
        requiredClaims: ["exp"],
      }));
    } catch (error) {
      if (isKeyRetrievalFailure(error)) {
        throw new OAuthError(
          OAuthErrorCode.ServerError,
          "The issuer's signing keys could not be retrieved.",
        );
      }
      logger.debug(
        `Access token rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new OAuthError(OAuthErrorCode.InvalidToken, INVALID_TOKEN_DESCRIPTION);
    }

    return {
      token,
      clientId:
        stringClaim(payload, "client_id") ??
        stringClaim(payload, "azp") ??
        payload.sub ??
        "unknown",
      scopes: (stringClaim(payload, "scope") ?? "").split(" ").filter(Boolean),
      expiresAt: payload.exp,
      extra: payload.sub ? { subject: payload.sub } : undefined,
    };
  }
}
