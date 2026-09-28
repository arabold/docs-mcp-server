/**
 * Option groups that several commands share. Options that map onto a
 * configuration setting declare no yargs `default`, so an omitted flag leaves
 * the setting to the environment, the config file or the built-in default.
 */

import type { Argv } from "yargs";

/**
 * Declare `--public-url` and its deprecated alias `--public-origin`.
 * @param yargs - The command's builder.
 * @returns The builder, for chaining.
 */
export function withPublicUrlOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("public-url", {
      type: "string",
      description:
        "Public URL clients use to reach the server, optionally with a path (e.g., https://example.com/docs)",
      alias: "publicUrl",
    })
    .option("public-origin", {
      type: "string",
      description: "Deprecated: use --public-url",
      alias: "publicOrigin",
    });
}

/**
 * Declare the options that configure authentication for the MCP endpoint.
 * @param yargs - The command's builder.
 * @returns The builder, for chaining.
 */
export function withAuthOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("auth-enabled", {
      type: "boolean",
      description: "Require a bearer token on the MCP endpoint over HTTP",
      defaultDescription: "false",
      alias: "authEnabled",
    })
    .option("auth-issuer-url", {
      type: "string",
      description:
        "Issuer URL of the OAuth2/OIDC provider; must match the issuer it publishes exactly",
      alias: "authIssuerUrl",
    })
    .option("auth-audience", {
      type: "string",
      description: "Audience tokens must carry; defaults to <public URL>/mcp",
      alias: "authAudience",
    });
}
