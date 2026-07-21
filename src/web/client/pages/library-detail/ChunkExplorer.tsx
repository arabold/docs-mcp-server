/**
 * Right-hand pane of the Library Detail two-pane layout: the active
 * version's chunk explorer — a stats strip, a content filter, and a
 * paginated list of expandable stored chunks rendered as Markdown.
 *
 * There's no separate "assembled" (full page reconstruction) view here —
 * the Search page already surfaces assembled results, so this pane always
 * shows the raw stored chunks.
 */
import { useEffect, useState } from "react";
import { useListVersionChunks, useVersionStats } from "../../api/hooks";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Input } from "../../components/Input";
import { Markdown } from "../../components/Markdown";
import { Loading } from "../../components/Spinner";
import { versionTabLabel } from "./format";

export interface ChunkExplorerProps {
  library: string;
  /** The active version (empty string for unversioned). */
  version: string;
}

const PAGE_SIZE = 20;
const FILTER_DEBOUNCE_MS = 300;

/** Renders a compact single-line preview of a chunk's Markdown content, stripped of most syntax. */
function previewOf(content: string): string {
  const stripped = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 160 ? `${stripped.slice(0, 160)}…` : stripped;
}

/** Renders a URL's path (+ hash) for compact display, falling back to the raw string if unparseable. */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.hash;
  } catch {
    return url;
  }
}

/**
 * @example <ChunkExplorer library="react" version="19.0" />
 */
export function ChunkExplorer({ library, version }: ChunkExplorerProps) {
  const [filter, setFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [offset, setOffset] = useState(0);

  // Debounce the content filter so it doesn't re-query on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedFilter(filter.trim()),
      FILTER_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [filter]);

  // Reset to the first page whenever the active version or filter changes.
  useEffect(() => {
    setOffset(0);
  }, [version, debouncedFilter]);

  const stats = useVersionStats({ library, version }, true);
  const chunksQuery = useListVersionChunks(
    { library, version, limit: PAGE_SIZE, offset, filter: debouncedFilter || undefined },
    true,
  );

  const chunks = chunksQuery.data?.chunks ?? [];
  const total = chunksQuery.data?.total ?? 0;

  return (
    <Card>
      <div className="explorer-head">
        <h3>
          Stored chunks{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            · version {versionTabLabel(version)}
          </span>
        </h3>
      </div>

      <div className="explorer-search">
        <Input
          icon="i-search"
          placeholder="Search or filter chunks in this version…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="explorer-stats">
        {stats.isLoading ? (
          <span className="text-faint">Loading stats…</span>
        ) : stats.data ? (
          <>
            <span>{stats.data.pageCount.toLocaleString()} pages</span>
            <span>{stats.data.chunkCount.toLocaleString()} chunks</span>
            <span>
              avg{" "}
              {stats.data.avgChunksPerPage != null
                ? stats.data.avgChunksPerPage.toFixed(1)
                : "—"}{" "}
              chunks / page
            </span>
            <span>
              {stats.data.embeddedChunkCount.toLocaleString()} /{" "}
              {stats.data.chunkCount.toLocaleString()} embedded
            </span>
          </>
        ) : (
          <span className="text-faint">Stats unavailable</span>
        )}
      </div>

      {chunksQuery.isLoading ? (
        <Loading label="Loading chunks…" />
      ) : chunksQuery.isError ? (
        <p className="muted" style={{ padding: "16px", color: "var(--err)" }}>
          Failed to load chunks: {chunksQuery.error.message}
        </p>
      ) : chunks.length === 0 ? (
        <EmptyState
          icon="i-search"
          title={
            debouncedFilter
              ? "No chunks match your filter"
              : "No chunks stored for this version"
          }
          description={debouncedFilter ? "Try a different search term." : undefined}
        />
      ) : (
        <>
          {chunks.map((chunk, i) => (
            <details className="chunk" key={chunk.id} open={offset === 0 && i === 0}>
              <summary>
                <span className="chunk__ix">#{offset + i + 1}</span>
                <div className="chunk__main">
                  <div className="chunk__path" title={chunk.url}>
                    {pathOf(chunk.url)}
                  </div>
                  <div className="chunk__prev">{previewOf(chunk.content)}</div>
                </div>
                <span className="chunk__tok">
                  {chunk.charCount.toLocaleString()} chars
                </span>
              </summary>
              <div className="chunk__body">
                <Markdown>{chunk.content}</Markdown>
                <div className="chunk__meta" style={{ marginTop: 12 }}>
                  <span className="meta-chip">{chunk.url}</span>
                  {chunk.mimeType ? (
                    <span className="meta-chip">{chunk.mimeType}</span>
                  ) : null}
                  <span className="meta-chip">
                    chunk {chunk.chunkIndex} of {chunk.pageChunkCount}
                  </span>
                  <span className="meta-chip">
                    {chunk.charCount.toLocaleString()} chars
                  </span>
                  {chunk.hasEmbedding ? (
                    <span className="meta-chip ok">embedded</span>
                  ) : null}
                </div>
              </div>
            </details>
          ))}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <span className="muted" style={{ fontSize: 12 }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
              {total.toLocaleString()} chunks
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
              >
                Prev
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
