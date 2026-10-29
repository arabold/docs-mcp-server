/**
 * Settings page: Read-only snapshot of the running server's configuration,
 * and management of MCP access tokens for securing client connections.
 */
import { type FormEvent, type ReactNode, useState } from "react";
import {
  useCreateMcpToken,
  useDeleteMcpToken,
  useListMcpTokens,
  useSystemHealth,
} from "../api/hooks";
import { trpc } from "../api/trpc";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { useConfirm } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Input } from "../components/Input";
import { McpAdminGate } from "../components/McpAdminGate";
import { Modal } from "../components/Modal";
import { Pill } from "../components/Pill";
import { Loading } from "../components/Spinner";
import type { StatusVariant } from "../components/StatusDot";
import { Table, TableBody, TableHead, Td, Th } from "../components/Table";
import { useToast } from "../components/Toast";
import { formatRelativeShort } from "../utils/format";

/** A single label/value row rendered inside a `.set-grid` panel. */
interface SettingRow {
  key: string;
  label: string;
  caption: string;
  value: ReactNode;
}

/** Small muted hint rendered next to formerly-toggle rows that have no mutation API yet. */
function ConfigNote() {
  return (
    <span className="muted" style={{ fontSize: 11.5 }}>
      Set via configuration/environment
    </span>
  );
}

/**
 * Renders one grouped settings panel: a section heading followed by a
 * `.card.panel` containing a `.set-grid` of label/value rows.
 */
function SettingsGroup({ title, rows }: { title: string; rows: SettingRow[] }) {
  return (
    <>
      <div className="section-head">
        <div>
          <h2 style={{ fontSize: 13.5 }}>{title}</h2>
        </div>
      </div>
      <Card className="panel">
        <div className="set-grid">
          {rows.flatMap((row) => [
            <div className="k" key={`${row.key}-k`}>
              <b>{row.label}</b>
              <span>{row.caption}</span>
            </div>,
            <div className="v" key={`${row.key}-v`}>
              {row.value}
            </div>,
          ])}
        </div>
      </Card>
    </>
  );
}

/**
 * Section for managing MCP access tokens.
 */
function McpTokensSection() {
  const { data: tokens, isLoading } = useListMcpTokens();
  const createMutation = useCreateMcpToken();
  const deleteMutation = useDeleteMcpToken();
  const utils = trpc.useUtils();
  const toast = useToast();
  const confirm = useConfirm();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [customToken, setCustomToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleCopy = async (tokenString: string) => {
    try {
      await navigator.clipboard.writeText(tokenString);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;

    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync({
        comment: comment.trim(),
        token: customToken.trim() || undefined,
      });
      await utils.listMcpTokens.invalidate();
      await utils.getMcpStatsOverview.invalidate();
      setComment("");
      setCustomToken("");
      setIsModalOpen(false);
      toast.success("MCP access token created");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create token");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (tokenId: number, tokenComment: string) => {
    const ok = await confirm({
      title: "Revoke Access Token",
      description: (
        <>
          Are you sure you want to revoke token <b>"{tokenComment}"</b>? Any MCP client
          using this token will immediately be denied access.
        </>
      ),
      confirmLabel: "Revoke Token",
    });

    if (!ok) return;

    try {
      await deleteMutation.mutateAsync({ id: tokenId });
      await utils.listMcpTokens.invalidate();
      await utils.getMcpStatsOverview.invalidate();
      toast.success("Token revoked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to revoke token");
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div
        className="section-head"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <span className="eyebrow">Security</span>
          <h2 style={{ fontSize: 13.5 }}>
            MCP Access Tokens {tokens ? `(${tokens.length})` : ""}
          </h2>
          <span className="sub" style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Tokens for authenticating AI assistants (Claude, Cursor, Windsurf, etc.) over
            MCP.
          </span>
        </div>
        <Button size="sm" variant="primary" onClick={() => setIsModalOpen(true)}>
          <Icon name="i-plus" size="xs" /> Create Token
        </Button>
      </div>

      <Card className="panel" style={{ padding: 0, overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ padding: 20 }}>
            <Loading label="Loading access tokens…" />
          </div>
        ) : tokens && tokens.length > 0 ? (
          <Table>
            <TableHead>
              <tr>
                <Th>Comment / Client</Th>
                <Th>Token</Th>
                <Th>Created</Th>
                <Th>Last Used</Th>
                <Th num>Actions</Th>
              </tr>
            </TableHead>
            <TableBody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Icon name="i-key" size="xs" style={{ color: "var(--primary)" }} />
                      <b>{t.comment}</b>
                    </div>
                  </Td>
                  <Td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <code
                        style={{
                          fontSize: 11.5,
                          background: "var(--surface-2)",
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontFamily: "var(--mono)",
                        }}
                      >
                        {t.token.slice(0, 10)}…{t.token.slice(-6)}
                      </code>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopy(t.token)}
                        title="Copy full token to clipboard"
                        style={{ padding: "2px 6px", height: "auto" }}
                      >
                        <Icon name="i-copy" size="xs" /> Copy
                      </Button>
                    </div>
                  </Td>
                  <Td style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {formatRelativeShort(new Date(t.createdAt))}
                  </Td>
                  <Td style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {t.lastUsedAt ? (
                      formatRelativeShort(new Date(t.lastUsedAt))
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>Never</span>
                    )}
                  </Td>
                  <Td num>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(t.id, t.comment)}
                      title="Revoke this token"
                      style={{ color: "var(--err)" }}
                    >
                      <Icon name="i-trash" size="xs" /> Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div style={{ padding: "30px 20px" }}>
            <EmptyState
              title="No access tokens"
              description="Create a token to allow MCP clients to connect to your documentation server."
              action={
                <Button size="sm" variant="primary" onClick={() => setIsModalOpen(true)}>
                  Create Token
                </Button>
              }
            />
          </div>
        )}
      </Card>

      {/* Quick Setup Instructions */}
      <Card
        className="panel"
        style={{ marginTop: 14, background: "var(--surface-1)", fontSize: 12 }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="i-globe" size="xs" /> How to configure MCP Clients (Claude, Cursor,
          Windsurf)
        </div>
        <p style={{ margin: "0 0 8px 0", color: "var(--text-muted)", fontSize: 11.5 }}>
          Supply your token in the <code>Authorization: Bearer &lt;TOKEN&gt;</code> HTTP
          header or the <code>x-api-key</code> header:
        </p>
        <pre
          style={{
            margin: 0,
            padding: "8px 12px",
            background: "var(--surface-2)",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "var(--mono)",
            overflowX: "auto",
          }}
        >
          {`{
  "mcpServers": {
    "docs": {
      "url": "http://127.0.0.1:6280/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}`}
        </pre>
      </Card>

      {/* Modal for Creating Token */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <form onSubmit={handleCreate}>
          <div style={{ padding: 20 }}>
            <h3 style={{ margin: "0 0 14px 0", fontSize: 15 }}>
              Create MCP Access Token
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input
                label="Comment / Description"
                placeholder="e.g. Friend Alex, Personal Cursor, Work Laptop"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={100}
                required
                autoFocus
              />
              <Input
                label="Custom Token (Optional)"
                placeholder="Leave blank to auto-generate a secure token"
                value={customToken}
                onChange={(e) => setCustomToken(e.target.value)}
                minLength={32}
                maxLength={256}
              />
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 20,
              }}
            >
              <Button
                variant="ghost"
                onClick={() => setIsModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={isSubmitting || !comment.trim()}
              >
                {isSubmitting ? "Creating…" : "Create Token"}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default function Settings() {
  const { data, isLoading, isError, error } = useSystemHealth();

  if (isLoading) {
    return <Loading label="Loading settings…" />;
  }

  if (isError || !data) {
    return (
      <Card className="panel" style={{ color: "var(--err)" }}>
        Failed to load settings: {error?.message ?? "Unknown error"}
      </Card>
    );
  }

  const health = data;

  const embeddingsRows: SettingRow[] = [
    {
      key: "provider",
      label: "Provider",
      caption: "Model used to embed indexed chunks",
      value: health.embeddings ? (
        <>
          <Pill variant="ok">{health.embeddings.provider}</Pill>
          <Chip>{health.embeddings.model}</Chip>
          <Chip>
            {health.embeddings.dimensions != null
              ? `${health.embeddings.dimensions} dims`
              : "dims unknown"}
          </Chip>
        </>
      ) : (
        <Pill variant="idle">Full-text search only</Pill>
      ),
    },
  ];

  const workerVariant: StatusVariant =
    health.worker.mode === "remote" ? (health.worker.connected ? "ok" : "err") : "ok";

  const serverRows: SettingRow[] = [
    {
      key: "worker",
      label: "Worker",
      caption: "Indexing pipeline execution",
      value:
        health.worker.mode === "remote" ? (
          <>
            <Pill variant={workerVariant}>remote</Pill>
            <Chip>{health.worker.url}</Chip>
            <Chip>{health.worker.connected ? "connected" : "disconnected"}</Chip>
          </>
        ) : (
          <Pill variant={workerVariant}>embedded</Pill>
        ),
    },
    {
      key: "mcp",
      label: "MCP server",
      caption: "Endpoint AI assistants connect to",
      value: health.mcp.enabled ? (
        <>
          <Pill variant="ok">enabled</Pill>
          <Chip>{health.mcp.url}</Chip>
        </>
      ) : (
        <Pill variant="idle">disabled</Pill>
      ),
    },
    {
      key: "readOnly",
      label: "Read-only mode",
      caption: "Disable all write operations",
      value: (
        <>
          <Pill variant="idle">{health.readOnly ? "on" : "off"}</Pill>
          <ConfigNote />
        </>
      ),
    },
    {
      key: "telemetry",
      label: "Telemetry",
      caption: "Anonymous usage analytics",
      value: (
        <>
          <Pill variant="idle">{health.telemetryEnabled ? "on" : "off"}</Pill>
          <ConfigNote />
        </>
      ),
    },
    {
      key: "version",
      label: "Version",
      caption: "docs-mcp-server release",
      value: <Chip>v{health.version}</Chip>,
    },
  ];

  const authRows: SettingRow[] = [
    {
      key: "access-tokens",
      label: "MCP access",
      caption: "Required credentials for every HTTP MCP request",
      value: (
        <Pill variant="ok">
          {health.auth.enabled ? "OAuth bearer token" : "MCP access token"}
        </Pill>
      ),
    },
    {
      key: "oauth",
      label: "OAuth2 / OIDC",
      caption: "External identity provider protection for MCP endpoint",
      value: (
        <Pill variant={health.auth.enabled ? "ok" : "idle"}>
          {health.auth.enabled ? "enabled" : "disabled"}
        </Pill>
      ),
    },
    ...(health.auth.enabled && health.auth.issuer
      ? [
          {
            key: "issuer",
            label: "Issuer",
            caption: "Identity provider",
            value: <Chip>{health.auth.issuer}</Chip>,
          },
        ]
      : []),
  ];

  return (
    <div>
      <div className="section-head" style={{ marginTop: 4 }}>
        <div>
          <span className="eyebrow">System</span>
          <h2>Settings</h2>
        </div>
      </div>

      <McpAdminGate>
        <McpTokensSection />
      </McpAdminGate>

      <div style={{ marginTop: 24 }}>
        <SettingsGroup title="Embeddings" rows={embeddingsRows} />
      </div>
      <SettingsGroup title="Server" rows={serverRows} />
      <SettingsGroup title="Authentication" rows={authRows} />
    </div>
  );
}
