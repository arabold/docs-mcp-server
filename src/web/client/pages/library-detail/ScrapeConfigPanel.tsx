/**
 * Left-hand pane of the Library Detail two-pane layout: a read-only summary
 * of how the active version was scraped (source, scope, limits, patterns,
 * headers, indexed-at), plus its three lifecycle actions — incremental
 * refresh, edit &amp; full re-index, and remove.
 */
import type { VersionSummary } from "../../../../store/types";
import {
  useEnqueueRefreshJob,
  useGetScraperOptions,
  useRemoveVersion,
} from "../../api/hooks";
import { trpc } from "../../api/trpc";
import { useDocumentationDrawer } from "../../components/AddEditDocumentationDrawer";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { useConfirm } from "../../components/ConfirmDialog";
import { Icon } from "../../components/Icon";
import { Pill } from "../../components/Pill";
import { Loading } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import {
  aggregateStatus,
  displayUrl,
  formatRelativeTime,
  MASKED_HEADER_VALUE,
} from "./format";

export interface ScrapeConfigPanelProps {
  library: string;
  /** The active version's summary (id, ref, status, counts, indexedAt, sourceUrl). */
  version: VersionSummary;
  /** Called after the version is successfully removed, so the parent can pick a new active tab. */
  onRemoved: () => void;
}

/**
 * Renders the active version's stored scraper configuration and its
 * lifecycle actions.
 * @example <ScrapeConfigPanel library="react" version={activeVersionSummary} onRemoved={() => setActiveVersion(null)} />
 */
export function ScrapeConfigPanel({
  library,
  version,
  onRemoved,
}: ScrapeConfigPanelProps) {
  const {
    data: stored,
    isLoading,
    isError,
  } = useGetScraperOptions({ versionId: version.id }, true);
  const enqueueRefreshJob = useEnqueueRefreshJob();
  const removeVersion = useRemoveVersion();
  const confirm = useConfirm();
  const toast = useToast();
  const drawer = useDocumentationDrawer();
  const utils = trpc.useUtils();

  const status = aggregateStatus([version.status]);
  const sourceUrl = stored?.sourceUrl ?? version.sourceUrl ?? null;
  const options = stored?.options;
  const versionLabel = version.ref.version || "Latest";
  const headerNames = options?.headers ? Object.keys(options.headers) : [];

  async function handleRefresh() {
    try {
      await enqueueRefreshJob.mutateAsync({ library, version: version.ref.version });
      await Promise.all([utils.listLibraries.invalidate(), utils.getJobs.invalidate()]);
      toast.success(`Refreshing ${library} ${versionLabel}`);
    } catch (err) {
      toast.error(
        "Failed to enqueue refresh",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async function handleRemove() {
    const ok = await confirm({
      title: "Remove version",
      description: (
        <>
          This permanently removes{" "}
          <b>
            {library} {versionLabel}
          </b>{" "}
          and its <b>{version.counts.documents.toLocaleString()} chunks</b> from the
          index. This can&rsquo;t be undone.
        </>
      ),
    });
    if (!ok) return;
    try {
      await removeVersion.mutateAsync({ library, version: version.ref.version });
      await utils.listLibraries.invalidate();
      toast.success(`Removed ${library} ${versionLabel}`);
      onRemoved();
    } catch (err) {
      toast.error(
        "Failed to remove version",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return (
    <Card className="panel">
      <div className="panel__head">
        <h3>Scrape configuration</h3>
        <Pill variant={status.variant} pulse={status.pulse}>
          {status.label}
        </Pill>
      </div>

      {isLoading ? (
        <Loading label="Loading configuration…" />
      ) : isError ? (
        <p className="muted" style={{ fontSize: 12.5 }}>
          Failed to load stored scraper configuration.
        </p>
      ) : (
        <div className="set-grid tight">
          <div className="k">
            <b>Source</b>
          </div>
          <div className="v">
            {sourceUrl ? (
              <a className="link" href={sourceUrl} target="_blank" rel="noreferrer">
                {displayUrl(sourceUrl)}
              </a>
            ) : (
              <span className="text-faint">—</span>
            )}
          </div>

          <div className="k">
            <b>Scope</b>
          </div>
          <div className="v">
            {options?.scope ?? <span className="text-faint">—</span>}
          </div>

          <div className="k">
            <b>Max pages</b>
          </div>
          <div className="v">
            {options?.maxPages != null ? (
              options.maxPages
            ) : (
              <span className="text-faint">unlimited</span>
            )}
          </div>

          <div className="k">
            <b>Max depth</b>
          </div>
          <div className="v">
            {options?.maxDepth != null ? (
              options.maxDepth
            ) : (
              <span className="text-faint">unlimited</span>
            )}
          </div>

          <div className="k">
            <b>Mode</b>
          </div>
          <div className="v">
            {options?.scrapeMode ?? <span className="text-faint">—</span>}
          </div>

          <div className="k">
            <b>Include</b>
          </div>
          <div className="v">
            {options?.includePatterns && options.includePatterns.length > 0 ? (
              options.includePatterns.join(", ")
            ) : (
              <span className="text-faint">all</span>
            )}
          </div>

          <div className="k">
            <b>Exclude</b>
          </div>
          <div className="v">
            {options?.excludePatterns && options.excludePatterns.length > 0 ? (
              options.excludePatterns.join(", ")
            ) : (
              <span className="text-faint">none</span>
            )}
          </div>

          <div className="k">
            <b>Headers</b>
          </div>
          <div className="v">
            {headerNames.length > 0 ? (
              headerNames.map((name) => (
                <span key={name} className="chip mono">
                  {name}: {MASKED_HEADER_VALUE}
                </span>
              ))
            ) : (
              <span className="text-faint">none</span>
            )}
          </div>

          <div className="k">
            <b>Preserve hashes</b>
          </div>
          <div className="v">
            {(options?.preserveHashes ?? version.preserveHashes) ? "yes" : "no"}
          </div>

          <div className="k">
            <b>Indexed</b>
          </div>
          <div className="v" title={version.indexedAt ?? undefined}>
            {formatRelativeTime(version.indexedAt)}
          </div>
        </div>
      )}

      <div className="cfg-actions">
        <Button onClick={handleRefresh} disabled={enqueueRefreshJob.isPending}>
          <Icon name="i-refresh" size="sm" />
          Refresh (incremental)
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            drawer.open({ mode: "edit", library, version: version.ref.version })
          }
        >
          <Icon name="i-settings" size="sm" />
          Edit &amp; re-index
        </Button>
        <button
          type="button"
          className="linkbtn"
          style={{ color: "var(--err)", justifyContent: "center", alignSelf: "stretch" }}
          onClick={handleRemove}
          disabled={removeVersion.isPending}
        >
          <Icon name="i-trash" size="xs" />
          Remove version
        </button>
      </div>
    </Card>
  );
}
