/**
 * Library Detail page (route `/libraries/:library`). Shows a library-level
 * header (icon, name, source, aggregate chips, library-wide actions), a
 * version switcher, and — for the active version — a two-pane layout with
 * the stored scrape configuration on the left and the chunk explorer on the
 * right, matching the mockup's Library Detail screen.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useEnqueueRefreshJob, useListLibraries } from "../api/hooks";
import { trpc } from "../api/trpc";
import { useDocumentationDrawer } from "../components/AddEditDocumentationDrawer";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icon";
import { LibIcon } from "../components/LibIcon";
import { Loading } from "../components/Spinner";
import { useToast } from "../components/Toast";
import { ChunkExplorer } from "./library-detail/ChunkExplorer";
import { displayUrl, formatCount } from "./library-detail/format";
import { ScrapeConfigPanel } from "./library-detail/ScrapeConfigPanel";
import { VersionTabs } from "./library-detail/VersionTabs";

export default function LibraryDetail() {
  const { library: libraryParam } = useParams<{ library: string }>();
  const library = libraryParam ?? "";
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useListLibraries();
  const enqueueRefreshJob = useEnqueueRefreshJob();
  const drawer = useDocumentationDrawer();
  const toast = useToast();
  const utils = trpc.useUtils();

  const lib = useMemo(
    () => data?.find((l) => l.library.toLowerCase() === library.toLowerCase()),
    [data, library],
  );

  const [activeVersion, setActiveVersion] = useState<string | null>(null);

  // Pick an active version once the library resolves, and fall back to the
  // first remaining version if the current selection disappears (e.g. after
  // removing it).
  useEffect(() => {
    if (!lib) return;
    setActiveVersion((prev) => {
      if (prev !== null && lib.versions.some((v) => v.ref.version === prev)) return prev;
      return lib.versions[0]?.ref.version ?? "";
    });
  }, [lib]);

  if (isLoading) {
    return <Loading label="Loading library…" />;
  }

  if (isError) {
    return (
      <Card className="panel" style={{ color: "var(--err)" }}>
        Failed to load library: {error.message}
      </Card>
    );
  }

  if (!lib) {
    return (
      <Card>
        <EmptyState
          icon="i-books"
          title="Library not found"
          description={`No library named "${library}" is indexed.`}
          action={
            <Button onClick={() => navigate("/libraries")}>Back to libraries</Button>
          }
        />
      </Card>
    );
  }

  const libraryName = lib.library;
  const libraryVersions = lib.versions;
  const sourceUrl = libraryVersions.find((v) => v.sourceUrl)?.sourceUrl;
  const totalPages = libraryVersions.reduce((sum, v) => sum + v.counts.uniqueUrls, 0);
  const totalChunks = libraryVersions.reduce((sum, v) => sum + v.counts.documents, 0);
  const activeVersionSummary = libraryVersions.find(
    (v) => v.ref.version === activeVersion,
  );

  async function handleRefreshAll() {
    try {
      await Promise.all(
        libraryVersions.map((v) =>
          enqueueRefreshJob.mutateAsync({ library: libraryName, version: v.ref.version }),
        ),
      );
      await Promise.all([utils.listLibraries.invalidate(), utils.getJobs.invalidate()]);
      toast.success(`Refreshing all versions of ${libraryName}`);
    } catch (err) {
      toast.error(
        "Failed to enqueue refresh",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <div>
      <button type="button" className="link back" onClick={() => navigate("/libraries")}>
        <Icon name="i-chevron" size="xs" style={{ transform: "rotate(180deg)" }} />
        All libraries
      </button>

      <Card className="panel detail-head">
        <LibIcon name={libraryName} url={sourceUrl} big />
        <div style={{ minWidth: 0 }}>
          <h2>{libraryName}</h2>
          {sourceUrl ? (
            <a
              className="lib-url"
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{ maxWidth: "none" }}
            >
              {displayUrl(sourceUrl)}
            </a>
          ) : null}
          <div className="chips">
            <Chip>
              {libraryVersions.length} version{libraryVersions.length === 1 ? "" : "s"}
            </Chip>
            <Chip>{formatCount(totalPages)} pages</Chip>
            <Chip>{formatCount(totalChunks)} chunks</Chip>
          </div>
        </div>
        <div className="detail-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => drawer.open({ mode: "add", library: libraryName })}
          >
            <Icon name="i-plus" size="sm" />
            Add version
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefreshAll}
            disabled={enqueueRefreshJob.isPending}
          >
            <Icon name="i-refresh" size="sm" />
            Refresh all
          </Button>
        </div>
      </Card>

      <VersionTabs
        versions={libraryVersions}
        activeVersion={activeVersion ?? ""}
        onSelect={setActiveVersion}
        onAddVersion={() => drawer.open({ mode: "add", library: libraryName })}
      />

      <div className="detail-grid">
        {activeVersionSummary ? (
          <ScrapeConfigPanel
            library={libraryName}
            version={activeVersionSummary}
            onRemoved={() => setActiveVersion(null)}
          />
        ) : (
          <Card className="panel">
            <Loading label="Loading version…" />
          </Card>
        )}
        <ChunkExplorer library={libraryName} version={activeVersion ?? ""} />
      </div>
    </div>
  );
}
