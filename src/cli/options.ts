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

/**
 * Declare the options that set how the server identifies itself to MCP
 * clients: name, title and instructions.
 * @param yargs - The command's builder.
 * @returns The builder, for chaining.
 */
export function withServerIdentityOptions<T>(yargs: Argv<T>) {
  return yargs
    .option("server-name", {
      type: "string",
      description: "Server name reported to MCP clients (default: docs-mcp-server)",
      alias: "serverName",
    })
    .option("server-title", {
      type: "string",
      description: "Human-readable server title shown by MCP clients",
      alias: "serverTitle",
    })
    .option("server-instructions", {
      type: "string",
      description: "Instructions text sent to MCP clients during initialization",
      alias: "serverInstructions",
    })
    .option("server-instructions-file", {
      type: "string",
      description:
        "Path to a file whose contents are sent to MCP clients as instructions (mutually exclusive with server.instructions; setting both fails startup)",
      alias: "serverInstructionsFile",
    });
}

/**
 * Declare `--accept-model-change`, which confirms a changed embedding model
 * without a prompt. Without the flag, `DOCS_MCP_ACCEPT_MODEL_CHANGE` decides.
 * @param yargs - The command's builder.
 * @returns The builder, for chaining.
 */
export function withModelChangeOptions<T>(yargs: Argv<T>) {
  return yargs.option("accept-model-change", {
    type: "boolean",
    description:
      "Confirm a changed embedding model without a prompt; deletes all stored vectors",
    defaultDescription: "false",
    alias: "acceptModelChange",
  });
}
