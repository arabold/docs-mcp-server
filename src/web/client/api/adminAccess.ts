let adminToken = "";

/**
 * Supplies the current tab's operator key without persisting it in browser storage.
 * @returns Authorization headers, or an empty object before sign-in.
 */
export function mcpAdminHeaders(): Record<string, string> {
  return adminToken ? { authorization: `Bearer ${adminToken}` } : {};
}

/**
 * Changes the operator key kept in memory for this browser tab.
 * @param token - The key supplied by the operator, or an empty string to sign out.
 * @returns Nothing after replacing the key.
 */
export function setMcpAdminToken(token: string): void {
  adminToken = token.trim();
}
