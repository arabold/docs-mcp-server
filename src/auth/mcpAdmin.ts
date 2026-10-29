import { createHash, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";

/**
 * Authorizes administrative MCP API operations with a separate operator key.
 * @param authorization - The request's Authorization header.
 * @param configuredToken - The operator key configured for this server.
 * @returns Nothing when access is allowed.
 */
export function requireMcpAdmin(
  authorization: string | undefined,
  configuredToken: string,
): void {
  if (!configuredToken) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Configure DOCS_MCP_ADMIN_TOKEN to manage MCP tokens and statistics.",
    });
  }
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (
    !token ||
    !timingSafeEqual(
      createHash("sha256").update(token).digest(),
      createHash("sha256").update(configuredToken).digest(),
    )
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "An administrative key is required.",
    });
  }
}
