## 1. Rule Evaluation

- [x] 1.1 Add a `GitignoreFilter` that loads `.gitignore` files from the crawl root downward and answers whether a path is ignored.
- [x] 1.2 Rewrite nested patterns to root-relative form and append them to the inherited matcher so Git's last-match-wins ordering applies across the cascade.
- [x] 1.3 Model Git's "a re-include cannot resurrect a file under an excluded directory" rule by blocking a directory's whole subtree when the parent matcher excludes it.
- [x] 1.4 Cache one context per directory and reuse the parent's matcher for directories that carry no rules.
- [x] 1.5 Detect the filesystem's case behavior the way Git does, and honour an explicit override.
- [x] 1.6 Always ignore `.git` and everything beneath it, ahead of any pattern evaluation.
- [x] 1.7 Add `findRepositoryRootAbove` as an existence-only upward probe, returning null for an unreadable or absent ancestor repository.
- [x] 1.8 Add unit tests covering scoping, negation, anchoring, globstars, whitespace and BOM handling, casing, `.git`, and the repository probe.
- [x] 1.9 Verify the cascade differentially against real `git` output across the pattern forms the rewriting touches.

## 2. Local Crawl Integration

- [x] 2.1 Build the filter in `LocalFileStrategy.scrape` when `respectGitignore` is set and the crawl root is a directory.
- [x] 2.2 Warn when the crawl root sits below a repository root.
- [x] 2.3 Prune ignored entries during directory enumeration so ignored directories are never descended into.
- [x] 2.4 Test a symlink as a path first and resolve its target only to decide whether a directory-only rule applies.
- [x] 2.5 Skip entries that cannot be stat'ed instead of failing the containing directory.
- [x] 2.6 Check ignored paths again when an item is processed, so refresh-seeded queue items are covered.
- [x] 2.7 Report newly ignored indexed pages as deleted, and ignored unindexed paths as contributing nothing.
- [x] 2.8 Let the physical archive path decide for archive members.
- [x] 2.9 Add strategy tests for default behavior, pruning, nested rules, unreadable entries, and refresh deletions.

## 3. Option Plumbing

- [x] 3.1 Add `respectGitignore` to `ScraperOptions` and to the persisted `VersionScraperOptions`.
- [x] 3.2 Add the `--respect-gitignore` CLI flag and forward it through `ScrapeTool`.
- [x] 3.3 Add the option to the MCP `scrape_docs` input schema and forward it.
- [x] 3.4 Add the Web UI control to the Add/Edit documentation drawer, rendered for `file://` sources.
- [x] 3.5 Surface the stored value on the Library Detail scrape-configuration panel.
- [x] 3.6 Confirm refresh and re-index reuse the stored value.
- [x] 3.7 Add tests for CLI, MCP, tool, store round-trip, and refresh propagation.

## 4. Documentation

- [x] 4.1 Document the option, its scope boundary, `.git` handling, and refresh behavior in the local-files guide.
- [x] 4.2 State the scope boundary in the CLI flag description and the MCP tool description.
