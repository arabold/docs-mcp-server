/**
 * Settings page. Read-only snapshot of the running server's configuration —
 * active embedding provider, worker wiring, MCP/auth exposure, telemetry,
 * read-only mode, and app version — sourced from `useSystemHealth`.
 *
 * There is currently no mutation API for any of these values: they reflect
 * how the process was started (env/YAML/CLI config), not a live toggle the
 * dashboard can flip. Rows that show a toggle in the mockup are rendered
 * here as a status `Pill` plus a small note pointing at configuration —
 * wiring up real mutation is tracked as a backlog item (see report).
 */
import type { ReactNode } from "react";
import { useSystemHealth } from "../api/hooks";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { Pill } from "../components/Pill";
import { Loading } from "../components/Spinner";
import type { StatusVariant } from "../components/StatusDot";

/** A single label/value row rendered inside a `.set-grid` panel. */
interface SettingRow {
  /** Unique key for the row (used to key the k/v DOM pair). */
  key: string;
  /** Bold row label, e.g. "Provider". */
  label: string;
  /** Muted caption under the label, e.g. "Model used to embed indexed chunks". */
  caption: string;
  /** The value cell's content — usually a `Pill`/`Chip` combination. */
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
      caption: "Protocol endpoints for AI assistants",
      value: health.mcp.enabled ? (
        <>
          <Pill variant="ok">enabled</Pill>
          {health.mcp.endpoints.map((endpoint) => (
            <Chip key={endpoint}>{endpoint}</Chip>
          ))}
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
      key: "oauth",
      label: "OAuth2 / OIDC",
      caption: "Protect the web UI and MCP endpoints",
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

      <SettingsGroup title="Embeddings" rows={embeddingsRows} />
      <SettingsGroup title="Server" rows={serverRows} />
      <SettingsGroup title="Authentication" rows={authRows} />
    </div>
  );
}
