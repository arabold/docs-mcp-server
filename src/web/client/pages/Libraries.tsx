/**
 * Libraries page. Wired for real (listLibraries, enqueueRefreshJob) and
 * doubles as Wave 3's reference example for the shared component library —
 * see `components/README.md` for the full catalogue of everything used
 * below.
 *
 * There's no atomic `removeLibrary` procedure yet (tracked as backlog), so
 * whole-library removal isn't offered here; per-version removal still lives
 * on the Library Detail page.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useEnqueueRefreshJob, useListLibraries } from "../api/hooks";
import { trpc } from "../api/trpc";
import { useDocumentationDrawer } from "../components/AddEditDocumentationDrawer";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { Input } from "../components/Input";
import { LibIcon } from "../components/LibIcon";
import { Pill } from "../components/Pill";
import { Loading } from "../components/Spinner";
import { Table, TableBody, TableHead, Td, Th } from "../components/Table";
import { useToast } from "../components/Toast";
import {
  aggregateStatus,
  displayUrl,
  formatRelativeTime,
  versionChipLabel,
} from "./library-detail/format";

export default function Libraries() {
  const { data, isLoading, isError, error } = useListLibraries();
  const enqueueRefreshJob = useEnqueueRefreshJob();
  const toast = useToast();
  const drawer = useDocumentationDrawer();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState("");

  const libraries = useMemo(() => {
    const all = data ?? [];
    const needle = filter.trim().toLowerCase();
    return needle ? all.filter((lib) => lib.library.toLowerCase().includes(needle)) : all;
  }, [data, filter]);

  if (isLoading) {
    return <Loading label="Loading libraries…" />;
  }

  if (isError) {
    return (
      <Card className="panel" style={{ color: "var(--err)" }}>
        Failed to load libraries: {error.message}
      </Card>
    );
  }

  /**
   * Refreshes every version of a library. There's no atomic "refresh
   * library" procedure, so this enqueues one incremental refresh job per
   * version (in parallel) rather than picking a single "latest" one.
   */
  async function handleRefresh(library: string, versions: string[]) {
    try {
      await Promise.all(
        versions.map((version) => enqueueRefreshJob.mutateAsync({ library, version })),
      );
      await Promise.all([utils.listLibraries.invalidate(), utils.getJobs.invalidate()]);
      toast.success(`Refreshing ${library}`);
    } catch (err) {
      toast.error(
        "Failed to enqueue refresh",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <div>
      <div className="section-head" style={{ marginTop: 4 }}>
        <div>
          <span className="eyebrow">
            {(data ?? []).length} libraries ·{" "}
            {(data ?? []).reduce((sum, lib) => sum + lib.versions.length, 0)} versions
          </span>
          <h2>Indexed libraries</h2>
        </div>
        <div style={{ width: 220 }}>
          <Input
            icon="i-search"
            placeholder="Filter libraries…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>

      {libraries.length === 0 ? (
        <Card>
          <EmptyState
            icon="i-books"
            title={
              data && data.length > 0
                ? "No libraries match your filter"
                : "No libraries indexed yet"
            }
            description={
              data && data.length > 0
                ? "Try a different search term."
                : "Add a library to start building your knowledge base."
            }
            action={
              !data || data.length === 0 ? (
                <Button onClick={() => drawer.open({ mode: "add" })}>Add library</Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <Th>Library</Th>
              <Th>Versions</Th>
              <Th>Status</Th>
              <Th num>Pages</Th>
              <Th num>Chunks</Th>
              <Th>Last indexed</Th>
              <Th />
            </tr>
          </TableHead>
          <TableBody>
            {libraries.map((lib) => {
              const statuses = lib.versions.map((v) => v.status);
              const status = aggregateStatus(statuses);
              const pages = lib.versions.reduce((sum, v) => sum + v.counts.uniqueUrls, 0);
              const chunks = lib.versions.reduce((sum, v) => sum + v.counts.documents, 0);
              const lastIndexed = lib.versions.reduce<string | null>((latest, v) => {
                if (!v.indexedAt) return latest;
                return !latest || v.indexedAt > latest ? v.indexedAt : latest;
              }, null);
              const sourceUrl = lib.versions.find((v) => v.sourceUrl)?.sourceUrl;
              const versionLabels = lib.versions.map((v) =>
                versionChipLabel(v.ref.version),
              );

              return (
                <tr key={lib.library}>
                  <Td>
                    <div
                      className="lib-cell"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        navigate(`/libraries/${encodeURIComponent(lib.library)}`)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter")
                          navigate(`/libraries/${encodeURIComponent(lib.library)}`);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <LibIcon name={lib.library} url={sourceUrl} />
                      <div>
                        <div className="lib-name">{lib.library}</div>
                        <div className="lib-url">{displayUrl(sourceUrl)}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="ver-list">
                      {versionLabels.map((v) => (
                        <Chip key={v}>{v}</Chip>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    <Pill variant={status.variant} pulse={status.pulse}>
                      {status.label}
                    </Pill>
                  </Td>
                  <Td num>{pages.toLocaleString()}</Td>
                  <Td num>{chunks.toLocaleString()}</Td>
                  <Td className="muted">{formatRelativeTime(lastIndexed)}</Td>
                  <Td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="act"
                        title="Open"
                        onClick={() =>
                          navigate(`/libraries/${encodeURIComponent(lib.library)}`)
                        }
                      >
                        <Icon name="i-ext" size="sm" />
                      </button>
                      <button
                        type="button"
                        className="act"
                        title="Refresh"
                        onClick={() =>
                          handleRefresh(
                            lib.library,
                            lib.versions.map((v) => v.ref.version),
                          )
                        }
                      >
                        <Icon name="i-refresh" size="sm" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
