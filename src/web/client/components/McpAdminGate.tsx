import { type FormEvent, type ReactNode, useState } from "react";
import { mcpAdminHeaders, setMcpAdminToken } from "../api/adminAccess";
import { useMcpAdminLogin } from "../api/hooks";
import { trpc } from "../api/trpc";
import { Button } from "./Button";
import { Card } from "./Card";
import { Input } from "./Input";

/**
 * Requires the operator key before mounting token management or statistics views.
 * @param props - The protected administration content.
 * @returns A sign-in form or the protected content and sign-out action.
 */
export function McpAdminGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(Boolean(mcpAdminHeaders().authorization));
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const login = useMcpAdminLogin();
  const utils = trpc.useUtils();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await login(token);
      setToken("");
      setUnlocked(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Administrative access failed.");
    } finally {
      setPending(false);
    }
  }

  function signOut() {
    setMcpAdminToken("");
    setUnlocked(false);
    utils.listMcpTokens.reset();
    utils.getMcpStatsOverview.reset();
    utils.getMcpRecentCalls.reset();
  }

  return unlocked ? (
    <div>
      <Button variant="ghost" size="sm" onClick={signOut}>
        Lock administration
      </Button>
      {children}
    </div>
  ) : (
    <Card className="panel">
      <h3>MCP administration</h3>
      <p>
        Enter the administrative key configured in DOCS_MCP_ADMIN_TOKEN. Client access
        tokens do not grant administrative access.
      </p>
      <form onSubmit={submit}>
        <Input
          label="Administrative key"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          required
        />
        {error ? <p role="alert">{error}</p> : null}
        <Button type="submit" disabled={pending || !token.trim()}>
          {pending ? "Checking…" : "Unlock administration"}
        </Button>
      </form>
    </Card>
  );
}
