> **Rebase note.** This delta assumes `filter-unprocessable-content` has landed and established step 3 as the unprocessable-extension filter. If that change is reordered or dropped, renumber the steps below accordingly.

## MODIFIED Requirements

### Requirement: Filter ordering for discovered links

Discovered links SHALL be filtered in this order, with each filter able to reject before later filters run:
1. URL parse — invalid URLs are rejected.
2. Archive-extension filter — links ending in `.zip`, `.tar`, `.gz`, or `.tgz` (case-insensitive) are rejected during crawl.
3. Unprocessable-extension filter — a MIME type is detected from the link's pathname via `MimeTypeUtils.detectMimeTypeFromPath()`; when detection returns a type that no configured pipeline can process, the link is rejected. When detection returns null the link proceeds.
4. Depth check — a link whose resulting depth would exceed the effective `maxDepth` is rejected.
5. Scope check — `isInScope(canonicalBaseUrl, target, scope)` must return true.
6. Pattern check — `shouldIncludeUrl(target, includePatterns, excludePatterns)` must return true (default exclusion patterns apply when no user excludePatterns are provided).
7. Optional `shouldFollowLink` callback — if configured, must return true.

Every filter SHALL be applied before the link is admitted to the queue. No link admitted to the queue may later be discarded on the basis of a condition that these filters could have evaluated, because admission advances the progress denominator.

Steps 2 and 3 overlap: archive extensions also resolve to MIME types no pipeline claims. The archive filter is retained as a distinct step because archive roots have separate depth-0 handling and its intent does not depend on pipeline composition.

#### Scenario: Scope reject short-circuits pattern check
- **WHEN** scope is `subpages` with base `https://example.com/api/`
- **AND** a discovered link is `https://other.com/api/intro`
- **THEN** the link is rejected by scope before patterns are evaluated

#### Scenario: Archive link rejected before scope check
- **WHEN** a discovered link is `https://example.com/api/dump.zip`
- **THEN** the link is rejected by the archive-extension filter regardless of scope

#### Scenario: Image link rejected before scope check
- **WHEN** a discovered link is `https://other.com/assets/diagram.png`
- **THEN** the link is rejected by the unprocessable-extension filter regardless of scope
- **AND** no HTTP request is issued for it

#### Scenario: Extensionless link survives the unprocessable filter
- **WHEN** a discovered link is `https://example.com/api/intro`
- **AND** `detectMimeTypeFromPath()` returns null for it
- **THEN** the unprocessable-extension filter does not reject it
- **AND** the link proceeds to the depth check

#### Scenario: Over-depth link is rejected at enqueue
- **GIVEN** `maxDepth` is 3
- **AND** a link is discovered on a page at depth 3
- **WHEN** the link is filtered
- **THEN** it is rejected by the depth check
- **AND** it is not added to the queue
- **AND** no progress counter advances for it

#### Scenario: At-depth link is admitted
- **GIVEN** `maxDepth` is 3
- **AND** a link is discovered on a page at depth 2
- **WHEN** the link is filtered
- **THEN** the depth check admits it at depth 3
- **AND** it is added to the queue

#### Scenario: Queued items are never dropped for depth
- **GIVEN** any crawl with any `maxDepth`
- **WHEN** an item is dequeued for processing
- **THEN** it is never discarded on the basis of its depth
- **AND** it reaches an outcome that advances the processed count

#### Scenario: Depth rejection does not consume a dedup slot
- **GIVEN** a URL is rejected by the depth check
- **WHEN** the same URL is later discovered from a different page at an acceptable depth
- **THEN** the earlier rejection does not cause the later discovery to be deduplicated away
- **AND** the URL is admitted to the queue on its merits

#### Scenario: Refresh mode preserves previously indexed pages
- **GIVEN** a refresh operation whose initial queue is populated from stored pages carrying their recorded depths
- **WHEN** those items are admitted to the queue
- **THEN** the depth filter is not applied to them, because it governs discovered links only
- **AND** no previously indexed page is left unrefreshed as a result of depth filtering

#### Scenario: Refresh depth limit is floored by the stored pages
- **GIVEN** a refresh whose stored scraper options are missing or unparseable, so `maxDepth` would fall back to the configured default
- **AND** stored pages recorded at depths greater than that default
- **WHEN** the refresh resolves its effective `maxDepth`
- **THEN** the effective `maxDepth` is at least the greatest depth among the stored pages
- **AND** no stored page is deeper than the limit of the refresh that processes it
