/**
 * Search Playground page. Lets the user pick an indexed library + version,
 * run a query against the same store the MCP `search` tool reads from, and
 * preview the exact full-context Markdown sections it would return.
 */
import { useState } from "react";
import { useListLibraries, useSearch } from "../api/hooks";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Input } from "../components/Input";
import { Markdown } from "../components/Markdown";
import { Loading } from "../components/Spinner";

/** Input shape accepted by {@link useSearch}, inferred from the hook itself. */
type SearchInput = Parameters<typeof useSearch>[0];

/** The library/version/query combination the user actually submitted. */
interface SubmittedSearch {
  library: string;
  version: string;
  query: string;
}

/** Results longer than this (chars) are clipped behind a "Show full result" toggle. */
const CLIP_THRESHOLD = 1200;

/** Labels the empty-string version (unversioned content) as "Latest", per the mockup. */
function versionLabel(version: string): string {
  return version === "" ? "Latest" : version;
}

export default function Search() {
  const { data: libraries } = useListLibraries();

  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState("");
  const [version, setVersion] = useState("");
  const [submitted, setSubmitted] = useState<SubmittedSearch | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const canSearch = library.trim() !== "" && query.trim() !== "";

  const searchInput: SearchInput = submitted
    ? { library: submitted.library, version: submitted.version, query: submitted.query }
    : { library: "", version: "", query: "" };

  const {
    data: results,
    isLoading,
    isError,
    error,
  } = useSearch(searchInput, submitted !== null);

  const selectedLibrary = (libraries ?? []).find((lib) => lib.library === library);
  const versionOptions = selectedLibrary
    ? Array.from(new Set(["", ...selectedLibrary.versions.map((v) => v.ref.version)]))
    : [""];

  function handleSearch() {
    if (!canSearch) return;
    setExpanded({});
    setSubmitted({ library, version, query: query.trim() });
  }

  function toggleExpanded(index: number) {
    setExpanded((prev) => ({ ...prev, [index]: !prev[index] }));
  }

  return (
    <div>
      <div className="section-head" style={{ marginTop: 4 }}>
        <div>
          <span className="eyebrow">Playground</span>
          <h2>Search the knowledge base</h2>
          <p>
            Preview exactly what the MCP <span className="mono">search</span> tool returns
            — full-context sections, assembled from matching chunks and rendered as
            Markdown.
          </p>
        </div>
      </div>

      <Card className="panel">
        <div className="search-lg">
          <Input
            icon="i-search"
            placeholder="How do I create a custom field validator?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
          />
          <select
            className="input"
            style={{ width: 180 }}
            value={library}
            onChange={(e) => {
              setLibrary(e.target.value);
              setVersion("");
            }}
          >
            <option value="" disabled>
              Select a library…
            </option>
            {(libraries ?? []).map((lib) => (
              <option key={lib.library} value={lib.library}>
                {lib.library}
              </option>
            ))}
          </select>
          <select
            className="input"
            style={{ width: 130 }}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            disabled={!library}
          >
            {versionOptions.map((v) => (
              <option key={v || "latest"} value={v}>
                {versionLabel(v)}
              </option>
            ))}
          </select>
          <Button
            onClick={handleSearch}
            disabled={!canSearch}
            style={{ padding: "11px 16px" }}
          >
            Search
          </Button>
        </div>
      </Card>

      <Card style={{ marginTop: 14 }}>
        {!submitted ? (
          <EmptyState
            icon="i-search"
            title="Search your indexed docs"
            description={
              "Choose a library, enter a query, and hit Search to preview " +
              "what the MCP search tool returns."
            }
          />
        ) : isLoading ? (
          <Loading label="Searching…" />
        ) : isError ? (
          <div className="panel" style={{ color: "var(--err)" }}>
            Search failed: {error.message}
          </div>
        ) : !results || results.length === 0 ? (
          <EmptyState
            icon="i-search"
            title="No results"
            description="Try a different query, library, or version."
          />
        ) : (
          <>
            <div className="results-meta">
              <span>
                <b>{results.length}</b> results
              </span>
              <span className="text-faint">·</span>
              <Chip>{submitted.library}</Chip>
              <Chip>{versionLabel(submitted.version)}</Chip>
            </div>
            {results.map((result, index) => {
              const isLong = result.content.length > CLIP_THRESHOLD;
              const isOpen = expanded[index] ?? false;
              const badge = result.sourceMimeType || result.mimeType || "unknown";
              return (
                <div
                  className="doc-result"
                  key={`${result.url}::${result.content.slice(0, 48)}`}
                >
                  <div className="doc-head">
                    <a href={result.url} target="_blank" rel="noreferrer">
                      {result.url}
                    </a>
                    <span className="doc-score">
                      {result.score != null ? result.score.toFixed(2) : "—"}
                    </span>
                    <Chip className="doc-badge">{badge}</Chip>
                  </div>
                  <Markdown
                    className={isLong ? (isOpen ? "clip is-open" : "clip") : undefined}
                  >
                    {result.content}
                  </Markdown>
                  {isLong ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="show-more"
                      onClick={() => toggleExpanded(index)}
                    >
                      {isOpen ? "Show less" : "Show full result"}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </>
        )}
      </Card>
    </div>
  );
}
