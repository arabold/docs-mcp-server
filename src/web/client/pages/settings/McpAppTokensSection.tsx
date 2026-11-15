import { type FormEvent, useState } from "react";
import type { McpAppToken } from "../../../../store/types";
import {
  useCreateMcpAppToken,
  useDeleteMcpAppToken,
  useListMcpAppTokens,
} from "../../api/hooks";
import { trpc } from "../../api/trpc";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { useConfirm } from "../../components/ConfirmDialog";
import { EmptyState } from "../../components/EmptyState";
import { Input } from "../../components/Input";
import { Modal } from "../../components/Modal";
import { Loading } from "../../components/Spinner";
import { Table, TableBody, TableHead, Td, Th } from "../../components/Table";
import { useToast } from "../../components/Toast";
import { formatRelativeShort } from "../../utils/format";

/** Manages the optional tokens that label MCP calls in Statistics. */
export function McpAppTokensSection() {
  const { data: tokens, isLoading, error } = useListMcpAppTokens();
  const create = useCreateMcpAppToken();
  const remove = useDeleteMcpAppToken();
  const utils = trpc.useUtils();
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [existingToken, setExistingToken] = useState("");
  const [issuedToken, setIssuedToken] = useState<string>();

  function close() {
    if (create.isPending) return;
    setOpen(false);
    setName("");
    setExistingToken("");
    setIssuedToken(undefined);
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const token = await create.mutateAsync({
        name: name.trim(),
        token: existingToken.trim() || undefined,
      });
      create.reset();
      if (!token) {
        toast.error("This token is already registered");
        return;
      }
      setExistingToken("");
      setIssuedToken(token.token);
      void utils.listMcpAppTokens.invalidate();
    } catch {
      create.reset();
      toast.error("Could not create the token", "Check the application name and token.");
    }
  }

  async function revokeToken(token: McpAppToken) {
    const confirmed = await confirm({
      title: "Revoke app token",
      description: (
        <>
          Calls using <b>{token.name}</b>’s token will be counted as anonymous. Its past
          calls remain in Statistics.
        </>
      ),
      confirmLabel: "Revoke",
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync({ id: token.id });
      void utils.listMcpAppTokens.invalidate();
      toast.success("App token revoked");
    } catch {
      toast.error("Could not revoke the token");
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token copied");
    } catch {
      toast.info("Select and copy the token from the field.");
    }
  }

  return (
    <>
      <div className="section-head">
        <div>
          <h2>MCP App Tokens</h2>
          <p>
            Label calls by application in Statistics. Clients can connect without a token.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Create token
        </Button>
      </div>
      <Card className="panel">
        {isLoading ? <Loading label="Loading app tokens…" /> : null}
        {error ? <p role="alert">Could not load app tokens.</p> : null}
        {tokens?.length === 0 ? <EmptyState title="No app tokens" /> : null}
        {tokens?.length ? (
          <Table>
            <TableHead>
              <tr>
                <Th>Application</Th>
                <Th>Last used</Th>
                <Th num>Actions</Th>
              </tr>
            </TableHead>
            <TableBody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <Td>{token.name}</Td>
                  <Td>
                    {token.lastUsedAt
                      ? formatRelativeShort(new Date(token.lastUsedAt))
                      : "Never"}
                  </Td>
                  <Td num>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Revoke token for ${token.name}`}
                      disabled={remove.isPending}
                      onClick={() => revokeToken(token)}
                    >
                      Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </Card>
      <Modal open={open} onClose={close} aria-labelledby="mcp-app-token-title">
        <h3 id="mcp-app-token-title">
          {issuedToken ? "App token created" : "Create app token"}
        </h3>
        {open && issuedToken ? (
          <>
            <Input
              label="Token"
              hint="Save it now. Add it to your MCP client's Authorization: Bearer header."
              value={issuedToken}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="modal__actions">
              <Button variant="ghost" onClick={() => copyToken(issuedToken)}>
                Copy token
              </Button>
              <Button onClick={close}>Done</Button>
            </div>
          </>
        ) : open ? (
          <form onSubmit={createToken}>
            <Input
              label="Application name"
              hint="Use a distinct name for each app you want to track."
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <Input
              label="Existing token (optional)"
              hint="Leave blank to generate a token."
              type="password"
              minLength={32}
              maxLength={256}
              autoComplete="off"
              value={existingToken}
              onChange={(event) => setExistingToken(event.currentTarget.value)}
            />
            <div className="modal__actions">
              <Button variant="ghost" onClick={close} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !name.trim()}>
                {create.isPending ? "Creating…" : "Create token"}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </>
  );
}
