/**
 * OAuth 2.0 resource-server support for the MCP endpoint.
 *
 * Authentication is optional and off by default. When enabled, the MCP
 * endpoint accepts only JWT access tokens that the configured issuer issued
 * for it, and publishes protected resource metadata so clients can find that
 * issuer.
 */

export {
  authorizationServerMetadataUrls,
  JwtAccessTokenVerifier,
} from "./JwtAccessTokenVerifier";
export {
  buildProtectedResourceMetadata,
  missingTokenChallenge,
  protectedResourceMetadataPaths,
  protectedResourceMetadataUrl,
} from "./protectedResourceMetadata";
export type { AuthConfig } from "./types";
