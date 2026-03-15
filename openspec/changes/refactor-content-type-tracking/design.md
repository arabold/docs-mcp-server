## Context

The `pages` table stores a single `content_type` column that is supposed to represent the MIME type of indexed content. However, the three scraper strategies populate it inconsistently:

- **`WebScraperStrategy`** (`src/scraper/strategies/WebScraperStrategy.ts:176`): Uses `processed.contentType || rawContent.mimeType`, which stores the pipeline output type. For HTML pages, `HtmlToMarkdownMiddleware` (`src/scraper/middleware/HtmlToMarkdownMiddleware.ts:116`) sets `context.contentType = "text/markdown"`, so HTML pages are stored as `text/markdown`.
- **`LocalFileStrategy`** (`src/scraper/strategies/LocalFileStrategy.ts:317`): Uses `rawContent.mimeType`, always storing the original fetcher-detected type.
- **`GitHubRepoProcessor`** (`src/scraper/strategies/GitHubRepoProcessor.ts:175`): Uses `rawContent.mimeType`, same as local files.
- **`DocumentPipeline`** (`src/scraper/pipelines/DocumentPipeline.ts:125`): Returns `contentType: "text/markdown"` after converting PDFs/Office docs, so `WebScraperStrategy` would store `text/markdown` for PDFs too.

The single `content_type` column cannot represent both the original source format and the stored content format. Consumers need both:
- The **source type** tells users what kind of document was indexed (useful for display, filtering, and debugging).
- The **processed type** tells renderers how to display the stored chunks (markdown rendering vs. code block vs. preformatted text).

## Goals / Non-Goals

**Goals:**
- Store both the original source MIME type and the post-processing MIME type on the `pages` table
- Fix the inconsistency across scraper strategies so all three populate both values correctly
- Ensure downstream consumers (assembly strategy, web UI, search API) use the correct field for their purpose
- Document the semantics clearly

**Non-Goals:**
- Adding per-chunk MIME types (all chunks from a page share the same pipeline output type today)
- Changing how pipelines transform content
- Changing MIME type detection logic (covered by the existing `refactor-mime-type-detection` change)

## Decisions

### Decision 1: Two Columns on `pages` -- `source_content_type` and `content_type`

**What:** Rename the existing `content_type` column to `source_content_type` (stores the original MIME type from the fetcher, e.g., `text/html`, `application/pdf`, `text/x-typescript`). Add a new `content_type` column (stores the post-processing MIME type from the pipeline, e.g., `text/markdown` for converted HTML/PDF, `text/x-typescript` for source code which passes through unchanged).

**Why:**
- `source_content_type` is immutable -- it reflects what was fetched, regardless of pipeline changes between versions.
- `content_type` reflects the actual format of the stored chunks, which is what renderers and assembly strategies need.
- The naming keeps `content_type` as the primary field for most consumers, since rendering is the most common use case.

**Alternatives considered:**
- Single column always storing original type: Would require assembly strategy and renderers to derive the processed type, which creates coupling to pipeline internals.
- Single column always storing processed type (current WebScraperStrategy behavior): Loses original source information; confusing when displayed in UI.
- Adding a boolean `is_converted` flag instead: Less flexible, doesn't capture the actual output type.

### Decision 2: `ProcessItemResult` and `ScrapeResult` Carry Both Types

**What:** Add `sourceContentType` field alongside the existing `contentType` field in `ProcessItemResult` (`BaseScraperStrategy.ts`) and `ScrapeResult` (`src/scraper/types.ts`).

**Why:** The scraper strategies are the boundary where both values are available -- the fetcher provides the original type, and the pipeline provides the processed type. Passing both through the result types keeps the data flow explicit.

### Decision 3: Assembly Strategy Uses `content_type` (Processed)

The `ContentAssemblyStrategyFactory` currently uses the page's MIME type to choose between `MarkdownAssemblyStrategy` and `HierarchicalAssemblyStrategy`. It SHALL continue using the **processed** `content_type`, since that reflects the actual chunk format:
- HTML pages converted to markdown -> `text/markdown` -> `MarkdownAssemblyStrategy`
- Source code passed through unchanged -> `text/x-typescript` -> `HierarchicalAssemblyStrategy`

### Decision 4: Web UI Displays Source Type, Renders by Processed Type

The web UI (`SearchResultItem.tsx`) currently shows the MIME type badge and uses it for rendering decisions. After this change:
- **Display**: Show `source_content_type` in the badge (users want to know the original format)
- **Rendering**: Use `content_type` (processed) to decide markdown vs. code rendering

### Decision 5: Search API Returns Both Types

`StoreSearchResult` SHALL include both `mimeType` (processed, for backward compatibility) and `sourceMimeType` (original). MCP tool consumers already use `mimeType` for rendering decisions, so the processed type stays as the primary field.

## Migration Plan

1. Add migration `0XX-split-content-type.sql`:
   - Add `source_content_type TEXT` column
   - Copy existing `content_type` values to `source_content_type` as a best-effort backfill (the existing values are a mix of original and processed depending on strategy, but it is the best approximation we have)
   - The existing `content_type` column stays as-is

2. All scraper strategies begin writing both columns on new scrape operations. Re-indexing existing libraries will fix both values automatically.

3. No destructive migration -- old data retains its existing `content_type` values.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Backfill for `source_content_type` is imprecise for web-scraped content | Acceptable: only affects display of old data; re-indexing fixes it |
| Adding a column increases schema complexity | Minimal: one column addition, clear semantics |
| Naming confusion between the two columns | Clear TSDoc and documentation; `source_` prefix is unambiguous |

## Open Questions

None -- the page-level-only approach was confirmed and the two-column design is straightforward.
