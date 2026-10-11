/**
 * OAuth 2.0 resource-server configuration for the MCP endpoint.
 */

/** Authentication settings as given on the command line or in configuration. */
export interface AuthConfig {
  /** Enable bearer-token authentication on the MCP endpoint. */
  enabled: boolean;
  /** The identity provider's issuer identifier. */
  issuerUrl?: string;
  /**
   * Expected token audience. Optional: defaults to the public URL of the MCP
   * endpoint, which is what clients request tokens for.
   */
  audience?: string;
}
