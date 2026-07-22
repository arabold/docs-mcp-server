/**
 * Shared "Add / Edit documentation" drawer, matching the mockup's Add
 * documentation drawer field-for-field (Library, Version, URL, Scope with a
 * live resolved-intent hint, then a collapsible Advanced options section).
 *
 * Mount `DocumentationDrawerProvider` once near the app root (see
 * `Shell.tsx`), then call `useDocumentationDrawer().open(...)` from any
 * component — Libraries list, Library detail, a failed job's "Edit & retry",
 * etc. — to open it without any local drawer-open state at the call site.
 *
 * - `{ mode: "add" }` — blank form; submitting calls `enqueueScrapeJob` and
 *   shows "Start indexing".
 * - `{ mode: "edit", library, version }` — prefills every field from the
 *   version's stored scraper options (via `getScraperOptions`), shows the
 *   destructive amber "this rebuilds from scratch" warning, and submitting
 *   shows "Save & re-index" (still `enqueueScrapeJob` — a full clean
 *   rebuild, as the warning says; incremental refresh is a separate action
 *   pages trigger directly with `useEnqueueRefreshJob`).
 *
 * @example
 * const drawer = useDocumentationDrawer();
 * <Button onClick={() => drawer.open({ mode: "add" })}>Add documentation</Button>
 * <Button onClick={() => drawer.open({ mode: "edit", library: "react", version: "19.0" })}>
 *   Edit &amp; re-index
 * </Button>
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ScrapeMode } from "../../../scraper/types";
import type { AppRouter } from "../../../services/appRouter";
import {
  useEnqueueScrapeJob,
  useGetScraperOptions,
  useListLibraries,
} from "../api/hooks";
import { trpc } from "../api/trpc";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Drawer } from "./Drawer";
import { Icon } from "./Icon";
import { SegmentedControl } from "./SegmentedControl";
import { Textarea } from "./Textarea";
import { useToast } from "./Toast";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type LibrarySummaryLike = RouterOutputs["listLibraries"][number];

export type DocumentationDrawerMode = "add" | "edit";

export interface OpenDocumentationDrawerOptions {
  mode: DocumentationDrawerMode;
  /** Required for "edit"; ignored for "add". */
  library?: string;
  /** Empty string / omitted means the unversioned variant. */
  version?: string;
}

type OpenDrawerFn = (options: OpenDocumentationDrawerOptions) => void;

const DocumentationDrawerContext = createContext<OpenDrawerFn | null>(null);

const DEFAULT_EXCLUDE_PATTERNS = "**/changelog*\n**/blog/**\n**/community/**\n**/*.pdf";

type Scope = "subpages" | "hostname" | "domain";

interface HeaderRow {
  /** Stable identity for React keys — header names aren't unique or stable. */
  id: string;
  name: string;
  value: string;
}

function findVersion(
  libraries: LibrarySummaryLike[] | undefined,
  library: string | undefined,
  version: string | undefined,
) {
  if (!libraries || !library) return undefined;
  const lib = libraries.find((l) => l.library.toLowerCase() === library.toLowerCase());
  const target = (version ?? "").toLowerCase();
  return lib?.versions.find((v) => (v.ref.version ?? "").toLowerCase() === target);
}

function parsePatterns(raw: string): string[] | undefined {
  const items = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function parsePositiveInt(raw: string): number | undefined {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function headersToRows(headers: Record<string, string> | undefined): HeaderRow[] {
  return Object.entries(headers ?? {}).map(([name, value]) => ({
    id: crypto.randomUUID(),
    name,
    value,
  }));
}

function rowsToHeaders(rows: HeaderRow[]): Record<string, string> | undefined {
  const record: Record<string, string> = {};
  for (const row of rows) {
    if (row.name.trim()) record[row.name.trim()] = row.value;
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

/** Computes the mockup's live "what will this index" hint text. */
function scopeHintFor(url: string, scope: Scope): string {
  let host = "the site";
  let path = "/";
  let root = "the domain";
  try {
    const u = new URL(url.trim());
    host = u.hostname;
    path = u.pathname || "/";
    root = host.split(".").slice(-2).join(".");
  } catch {
    // Leave the generic placeholders — the URL isn't parseable yet.
  }
  if (scope === "subpages") return `Indexes only pages under ${path} on ${host}.`;
  if (scope === "hostname") return `Indexes every page on ${host}.`;
  return `Indexes ${root} and all of its subdomains.`;
}

const SCOPE_OPTIONS: ReadonlyArray<{ value: Scope; label: string }> = [
  { value: "subpages", label: "Under this path" },
  { value: "hostname", label: "Entire site" },
  { value: "domain", label: "+ Subdomains" },
];

const SCRAPE_MODE_OPTIONS: ReadonlyArray<{ value: ScrapeMode; label: string }> = [
  { value: ScrapeMode.Auto, label: "Auto" },
  { value: ScrapeMode.Fetch, label: "Fetch" },
  { value: ScrapeMode.Playwright, label: "Playwright" },
];

/** Provides the `useDocumentationDrawer()` hook and renders the shared drawer. */
export function DocumentationDrawerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenDocumentationDrawerOptions & { open: boolean }>({
    open: false,
    mode: "add",
  });

  const open = useCallback<OpenDrawerFn>((options) => {
    setState({ ...options, open: true });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  return (
    <DocumentationDrawerContext.Provider value={open}>
      {children}
      <DrawerForm
        open={state.open}
        mode={state.mode}
        library={state.library}
        version={state.version}
        onClose={close}
      />
    </DocumentationDrawerContext.Provider>
  );
}

/** Returns `{ open }` to launch the shared documentation drawer. Must be used under `DocumentationDrawerProvider`. */
export function useDocumentationDrawer(): { open: OpenDrawerFn } {
  const open = useContext(DocumentationDrawerContext);
  if (!open) {
    throw new Error(
      "useDocumentationDrawer must be used within a DocumentationDrawerProvider",
    );
  }
  return { open };
}

interface DrawerFormProps {
  open: boolean;
  mode: DocumentationDrawerMode;
  library: string | undefined;
  version: string | undefined;
  onClose: () => void;
}

function DrawerForm({ open, mode, library, version, onClose }: DrawerFormProps) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const { data: libraries } = useListLibraries();
  const matchedVersion = useMemo(
    () => findVersion(libraries, library, version),
    [libraries, library, version],
  );
  const versionId = matchedVersion?.id;
  const { data: stored } = useGetScraperOptions(
    { versionId: versionId ?? -1 },
    open && mode === "edit" && versionId != null,
  );
  const enqueueScrapeJob = useEnqueueScrapeJob();

  const [libraryName, setLibraryName] = useState("");
  const [versionName, setVersionName] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<Scope>("subpages");
  const [maxPages, setMaxPages] = useState("");
  const [maxDepth, setMaxDepth] = useState("");
  const [includePatterns, setIncludePatterns] = useState("");
  const [excludePatterns, setExcludePatterns] = useState(DEFAULT_EXCLUDE_PATTERNS);
  const [scrapeMode, setScrapeMode] = useState<ScrapeMode>(ScrapeMode.Auto);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [preserveHashes, setPreserveHashes] = useState(false);
  const [followRedirects, setFollowRedirects] = useState(true);
  const [ignoreErrors, setIgnoreErrors] = useState(true);

  // Reset to blank/basic defaults every time the drawer is (re)opened.
  useEffect(() => {
    if (!open) return;
    setLibraryName(library ?? "");
    setVersionName(version ?? "");
    setUrl("");
    setScope("subpages");
    setMaxPages("");
    setMaxDepth("");
    setIncludePatterns("");
    setExcludePatterns(DEFAULT_EXCLUDE_PATTERNS);
    setScrapeMode(ScrapeMode.Auto);
    setHeaders([]);
    setPreserveHashes(false);
    setFollowRedirects(true);
    setIgnoreErrors(true);
  }, [open, library, version]);

  // Overlay stored scraper options once they resolve, for "edit" mode.
  useEffect(() => {
    if (!open || mode !== "edit" || !stored) return;
    setUrl(stored.sourceUrl ?? "");
    setScope(stored.options.scope ?? "subpages");
    setMaxPages(stored.options.maxPages != null ? String(stored.options.maxPages) : "");
    setMaxDepth(stored.options.maxDepth != null ? String(stored.options.maxDepth) : "");
    setIncludePatterns((stored.options.includePatterns ?? []).join("\n"));
    setExcludePatterns(
      stored.options.excludePatterns && stored.options.excludePatterns.length > 0
        ? stored.options.excludePatterns.join("\n")
        : DEFAULT_EXCLUDE_PATTERNS,
    );
    setScrapeMode(stored.options.scrapeMode ?? ScrapeMode.Auto);
    setHeaders(headersToRows(stored.options.headers));
    setPreserveHashes(stored.options.preserveHashes ?? false);
    setFollowRedirects(stored.options.followRedirects ?? true);
    setIgnoreErrors(stored.options.ignoreErrors ?? true);
  }, [open, mode, stored]);

  const scopeHint = useMemo(() => scopeHintFor(url, scope), [url, scope]);

  const addHeaderRow = useCallback(() => {
    setHeaders((prev) => [...prev, { id: crypto.randomUUID(), name: "", value: "" }]);
  }, []);
  const removeHeaderRow = useCallback((index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
  }, []);
  const updateHeaderRow = useCallback((index: number, patch: Partial<HeaderRow>) => {
    setHeaders((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }, []);

  const trimmedLibrary = libraryName.trim();
  const trimmedVersion = versionName.trim();
  const trimmedUrl = url.trim();
  const canSubmit =
    trimmedLibrary.length > 0 && trimmedUrl.length > 0 && !enqueueScrapeJob.isPending;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    try {
      await enqueueScrapeJob.mutateAsync({
        library: trimmedLibrary,
        version: trimmedVersion || undefined,
        options: {
          url: trimmedUrl,
          library: trimmedLibrary,
          version: trimmedVersion,
          scope,
          followRedirects,
          maxPages: parsePositiveInt(maxPages),
          maxDepth: parsePositiveInt(maxDepth),
          ignoreErrors,
          scrapeMode,
          includePatterns: parsePatterns(includePatterns),
          excludePatterns: parsePatterns(excludePatterns),
          preserveHashes,
          headers: rowsToHeaders(headers),
        },
      });
      await utils.invalidate();
      toast.success(
        mode === "edit"
          ? `Re-indexing ${trimmedLibrary}${trimmedVersion ? ` ${trimmedVersion}` : ""}`
          : `Started indexing ${trimmedLibrary}${trimmedVersion ? ` ${trimmedVersion}` : ""}`,
      );
      onClose();
    } catch (err) {
      toast.error(
        mode === "edit" ? "Failed to save & re-index" : "Failed to start indexing",
        err instanceof Error ? err.message : String(err),
      );
    }
  }, [
    canSubmit,
    enqueueScrapeJob,
    trimmedLibrary,
    trimmedVersion,
    trimmedUrl,
    scope,
    followRedirects,
    maxPages,
    maxDepth,
    ignoreErrors,
    scrapeMode,
    includePatterns,
    excludePatterns,
    preserveHashes,
    headers,
    utils,
    toast,
    mode,
    onClose,
  ]);

  // "add" is used both for a brand-new library (no `library` context, from the
  // topbar/empty state) and for adding a version to an existing library (from
  // the Library Detail "Add version"), so the title reflects which one it is.
  const title =
    mode === "edit"
      ? `Edit config — ${library ?? trimmedLibrary}${version ? ` ${version}` : ""}`
      : library
        ? "Add version"
        : "Add library";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            <Icon name={mode === "edit" ? "i-refresh" : "i-bolt"} size="sm" />
            {mode === "edit" ? "Save & re-index" : "Start indexing"}
          </Button>
        </>
      }
    >
      {mode === "edit" ? (
        <div className="note note--warn">
          <Icon name="i-refresh" size="sm" />
          <span>
            Re-indexing <b>deletes the current chunks</b> for this version and rebuilds
            from scratch — it reads as empty while running. To update in place, close this
            and use <b>Refresh</b> instead.
          </span>
        </div>
      ) : null}

      <div className="form-2">
        <div className="form-row">
          <label htmlFor="doc-drawer-library">Library name</label>
          <input
            id="doc-drawer-library"
            className="input"
            placeholder="e.g. react, vue, express"
            value={libraryName}
            onChange={(e) => setLibraryName(e.target.value)}
            disabled={mode === "edit" || Boolean(library)}
          />
        </div>
        <div className="form-row">
          <label htmlFor="doc-drawer-version">
            Version{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (optional)
            </span>
          </label>
          <input
            id="doc-drawer-version"
            className="input"
            placeholder="e.g. 2.0.0 or latest"
            value={versionName}
            onChange={(e) => setVersionName(e.target.value)}
            disabled={mode === "edit"}
          />
        </div>
      </div>

      <div className="form-row">
        <label htmlFor="doc-drawer-url">URL</label>
        <input
          id="doc-drawer-url"
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <span className="hint">
          Web page, sitemap, or a <span className="mono">file://</span> path. Local paths
          must be accessible to the server.
        </span>
      </div>

      <div className="form-row">
        <span className="form-label">
          What to index{" "}
          <span className="muted" style={{ fontWeight: 400 }}>
            · scope
          </span>
        </span>
        <SegmentedControl
          variant="full"
          aria-label="Indexing scope"
          options={SCOPE_OPTIONS}
          value={scope}
          onChange={setScope}
          hint={
            <div className="note">
              <Icon name="i-globe" size="sm" />
              <span>{scopeHint}</span>
            </div>
          }
        />
      </div>

      <details className="adv">
        <summary>
          <Icon name="i-chevron" size="sm" className="chev" />
          Advanced options
          <span className="tag">limits · patterns · headers</span>
        </summary>
        <div className="adv__body">
          <div className="form-2">
            <div className="form-row">
              <label htmlFor="doc-drawer-max-pages">Max pages</label>
              <input
                id="doc-drawer-max-pages"
                className="input mono"
                inputMode="numeric"
                placeholder="1000"
                value={maxPages}
                onChange={(e) => setMaxPages(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label htmlFor="doc-drawer-max-depth">Max depth</label>
              <input
                id="doc-drawer-max-depth"
                className="input mono"
                inputMode="numeric"
                placeholder="3"
                value={maxDepth}
                onChange={(e) => setMaxDepth(e.target.value)}
              />
            </div>
          </div>

          <Textarea
            label={
              <>
                Include patterns{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (optional)
                </span>
              </>
            }
            className="mono"
            placeholder={"docs/*\n/api\\/v1.*/"}
            hint="Glob or regex, one per line or comma-separated. Wrap regex in slashes."
            value={includePatterns}
            onChange={(e) => setIncludePatterns(e.target.value)}
          />

          <Textarea
            label="Exclude patterns"
            className="mono"
            rows={4}
            hint="Default patterns are pre-filled. Exclude takes precedence over include — clear to exclude nothing."
            value={excludePatterns}
            onChange={(e) => setExcludePatterns(e.target.value)}
          />

          <div className="form-row">
            <span className="form-label">Scrape mode</span>
            <SegmentedControl
              variant="full"
              aria-label="Scrape mode"
              options={SCRAPE_MODE_OPTIONS}
              value={scrapeMode}
              onChange={setScrapeMode}
              hint={
                <span className="hint">
                  Auto uses a headless browser only for JS-heavy sites; Fetch is plain
                  HTTP.
                </span>
              }
            />
          </div>

          <div className="form-row">
            <span className="form-label">Custom HTTP headers</span>
            <div>
              {headers.map((row, index) => (
                <div className="hdr-row" key={row.id}>
                  <input
                    className="input mono"
                    placeholder="Header name"
                    value={row.name}
                    onChange={(e) => updateHeaderRow(index, { name: e.target.value })}
                  />
                  <input
                    className="input mono"
                    placeholder="Value"
                    value={row.value}
                    onChange={(e) => updateHeaderRow(index, { value: e.target.value })}
                  />
                  <button
                    type="button"
                    className="x"
                    title="Remove"
                    onClick={() => removeHeaderRow(index)}
                  >
                    <Icon name="i-close" size="sm" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="linkbtn" onClick={addHeaderRow}>
              <Icon name="i-plus" size="xs" />
              Add header
            </button>
          </div>

          <Checkbox
            label="Preserve hash routes"
            hint={
              <>
                For docs sites that use <span className="mono">#/</span> fragments as
                client-side routes.
              </>
            }
            checked={preserveHashes}
            onChange={(e) => setPreserveHashes(e.target.checked)}
          />
          <Checkbox
            label="Follow redirects"
            hint="Follow 3xx responses automatically."
            checked={followRedirects}
            onChange={(e) => setFollowRedirects(e.target.checked)}
          />
          <Checkbox
            label="Ignore errors during scraping"
            hint="Skip pages that fail instead of aborting the whole job."
            checked={ignoreErrors}
            onChange={(e) => setIgnoreErrors(e.target.checked)}
          />
        </div>
      </details>
    </Drawer>
  );
}
