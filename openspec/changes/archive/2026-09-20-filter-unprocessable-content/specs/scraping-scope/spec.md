> **Archive-order note.** `define-scrape-progress-semantics` modifies this same requirement to add the depth check, and restates the step 3 rule below so its version is complete. This change SHALL be archived first; archiving it after would drop that depth check from the merged requirement.

## MODIFIED Requirements

### Requirement: Filter ordering for discovered links

Discovered links SHALL be filtered in this order, with each filter able to reject before later filters run:
1. URL parse — invalid URLs are rejected.
2. Archive-extension filter — links ending in `.zip`, `.tar`, `.gz`, or `.tgz` (case-insensitive) are rejected during crawl.
3. Unprocessable-media filter — a MIME type is detected from the link's pathname via `MimeTypeUtils.detectMimeTypeFromPath()`; the link is rejected only when that type names binary media (`image/*`, `video/*`, `audio/*`, `font/*`) that no configured pipeline can process. Any other detected type, and a null detection, proceed to the remaining filters.
4. Scope check — `isInScope(canonicalBaseUrl, target, scope)` must return true.
5. Pattern check — `shouldIncludeUrl(target, includePatterns, excludePatterns)` must return true (default exclusion patterns apply when no user excludePatterns are provided).
6. Optional `shouldFollowLink` callback — if configured, must return true.

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
- **THEN** the link is rejected by the unprocessable-media filter regardless of scope
- **AND** no HTTP request is issued for it

#### Scenario: Script link with a misclassified extension survives the filter
- **WHEN** a discovered link is `https://example.com/Guess/guess.ps`
- **AND** detection resolves it to `application/postscript`, which is not binary media
- **THEN** the unprocessable-media filter does not reject it
- **AND** the link proceeds to the scope check

#### Scenario: Extensionless link survives the new filter
- **WHEN** a discovered link is `https://example.com/api/intro`
- **AND** `detectMimeTypeFromPath()` returns null for it
- **THEN** the unprocessable-media filter does not reject it
- **AND** the link proceeds to the scope check
