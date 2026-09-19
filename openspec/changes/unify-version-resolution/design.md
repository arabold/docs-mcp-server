# Design

## Context

See proposal.md — Why. The relevant current state:

- **Write paths disagree.** `ScrapeTool` validates and coerces a version label (rejecting `stable`,
  rewriting `1.20` → `1.20.0`); `RefreshVersionTool` carries a byte-identical copy of that gate. The web
  UI, the Jobs page and the pipeline tRPC router trim only, then `PipelineManager` does `version ?? ""`
  and `DocumentStore.resolveVersionId` lowercases and inserts whatever it is given.
- **The read path only understands semver.** `listVersions()` filters out anything it cannot classify as a
  version, and `findBestVersion()` matches with `semver.maxSatisfying`, which excludes prereleases from
  range matching by default.
- **A normalizer already exists.** `normalizeVersionRef` in `src/store/types.ts` does exactly
  trim + lowercase + empty-means-unversioned, but only three call sites use it.
- **Storage needs no change.** `versions.name` is `TEXT` with `UNIQUE(library_id, name)` and NULL for
  unversioned, so arbitrary labels are already storable and already stored.
- **PR #497 is open against the same code.** It introduced `VersionCandidate` / `toVersionCandidate` in
  `src/utils/version.ts` and a `selectStoredVersion` tie-break in `findBestVersion`. This design builds on
  the former and supersedes the latter.

## Goals / Non-Goals

**Goals:**

- One normalization function, applied at the store boundary, that every write path reaches.
- A label classification that is a routing decision (version vs. tag), not a validity judgement.
- A resolution order that is explicit and enumerable, so it can be specified and tested rung by rung.
- Full backward compatibility for databases already containing un-normalized labels, with no migration.

**Non-Goals:**

- Changing the database schema or migrating existing rows.
- Canonicalizing labels on write — deliberately rejected; see Decisions.
- Expanding the `find_version` response message to explain how a match was reached.
- Reworking how search results are assembled once a version is resolved (see the `search` capability).

## Decisions

### D1: A single normalizer, enforced at the store boundary

Promote the version half of `normalizeVersionRef` into a shared `normalizeVersionLabel(version)` —
trim, lowercase, empty means unversioned — and call it from `DocumentStore.resolveVersionId`, the last
point every write passes through. Upstream layers (tools, pipeline, tRPC) call the same function so that
lookups and dedup agree with what will be stored, but correctness does not depend on them doing so.

*Alternative considered:* keep normalization at the tool layer and add it to the web UI path. Rejected —
that is the current architecture, and it fails exactly when a new entry point is added, which is how the
web UI diverged in the first place.

### D2: Delete the write gates rather than relocate them

With verbatim storage there is nothing left to validate: a label is trimmed, lowercased and stored. The
gates in `ScrapeTool` and `RefreshVersionTool` are removed rather than moved down a layer.

*Alternative considered:* move the semver gate to the store so all paths reject `stable` uniformly.
Rejected — it contradicts the tag tier, and it would start rejecting labels the web UI already writes,
breaking existing libraries.

### D3: Classification is routing, not validation

Extend the `VersionCandidate` model from PR #497 to classify every label as either a semantic version or
an opaque tag; nothing is discarded. `toVersionCandidate` keeps its gated coercion — strict semver first,
falling back to coercion only for `v?major[.minor]` — and anything else becomes a tag instead of `null`.

*Alternative considered:* one tier with permissive coercion. Rejected, and already demonstrated harmful:
ungated `semver.coerce` turns `stable-2024` into `2024.0.0` and `node18` into `18.0.0`, which then outrank
real releases.

### D4: Literal-first resolution

Resolution is an ordered ladder, each rung total and independently testable:

```
  1. literal match on stored label (trim + lowercase, equality)
  2. semantic version resolution over version-tier labels
  3. exactly one tag exists -> use it; more than one -> error listing labels
  4. unversioned bucket, when it exists
  5. throw, listing every available label
```

Rung 1 subsumes PR #497's `selectStoredVersion` tie-break: a request for `1.20` returns `1.20` because it
matches literally, not because of a preference heuristic buried in the matcher. It also makes a stored
`latest` or `1.x` reachable by its own name, which is what closes #475.

*Alternative considered:* semver-first with a literal fallback. Rejected — a stored `1.20` would then be
answered by `1.20.0` whenever both exist, which is the bug this replaces.

### D5: Prereleases rank as ordinary versions

Pass `includePrerelease: true` to both `semver.maxSatisfying` calls. Semver's default exclusion exists to
stop a package manager installing unstable code; this system retrieves documentation, where the cost of
reading slightly-ahead docs is far lower than the cost of being handed a different major version. The
corpus is also curated — every indexed version was chosen deliberately by an operator.

The safety properties fall out of ordering rather than needing rules: a released `2.0.0` beats its own
`2.0.0-beta` because it is genuinely higher, and a request for `1.0.0` never reaches `1.0.1-beta` because
that is above the request.

*Alternative considered:* a two-pass fallback (stable first, prereleases only when nothing stable
matches). Rejected as strictly more machinery for the same answers in every case except `latest` over
`[1.0.0, 2.0.0-beta]`, where two-pass returns the older major — the outcome this change intends to fix.

### D6: No data migration

Existing databases hold labels written verbatim by the web UI. Under the new write contract those labels
are already valid, so there is nothing to migrate. Read-side tolerance is what makes them resolvable, and
it is permanent behavior rather than a transitional shim.

*Alternative considered:* a migration canonicalizing existing labels. Rejected — it would merge buckets a
user deliberately created, and it contradicts D1's verbatim rule.

### D7: One comparator for every listing surface

`queryLibraryVersions` orders lexicographically in SQL, which puts `1.10.0` before `1.9.0`; the web UI
consumes that order unsorted and defaults to `versions[0]`. Semver ordering cannot be expressed in SQLite
`ORDER BY`, so sorting moves to the service layer using the same comparator the resolver uses, extended
to place unversioned first and opaque tags last in alphabetical order.

*Alternative considered:* sort in each consumer. Rejected — that is how the two orderings diverged.

## Risks / Trade-offs

- **`latest` over `[1.0.0, 2.0.0-beta]` now returns the prerelease** → Behavior change, accepted
  deliberately. Self-correcting: once `2.0.0` is indexed it wins, per D5. Called out as BREAKING in the
  proposal.
- **`scrape_docs` accepts labels it used to reject** → Strictly widening; no previously-succeeding call
  changes behavior. The `ValidationError` and its test at `src/tools/ScrapeTool.test.ts:94` are removed,
  not merely relaxed.
- **`1.20` is no longer coerced on write** → The same input now yields a different stored label than it
  did before. Both forms remain resolvable via rung 1, and pre-existing `1.20.0` rows are untouched.
- **A stored tag can shadow a request that looks like a range** → A library with a literal `1.x` bucket
  answers a `1.x` request with that bucket rather than range-matching. Deliberate and specified; it is the
  same mechanism that makes a stored `latest` reachable.
- **Tag ordering is newly defined** → `compareVersionsDescending` currently falls back to *reverse* string
  comparison for non-semver labels, so tags sort Z→A and interleave with versions. D7 changes that to
  alphabetical and grouped last; any snapshot of listing order will shift.
- **Rung 3 fires only when no semantic version exists** → A library with both `1.0.0` and `stable` and no
  explicit request resolves to `1.0.0`. A caller wanting the tag must name it.

## Migration Plan

No data migration. Rollout is behavioral:

1. Land the shared normalizer and route every write path through it; existing rows are unaffected.
2. Remove the duplicated gates in `ScrapeTool` and `RefreshVersionTool`, updating their tests.
3. Land the classification and resolution ladder, superseding `selectStoredVersion`.
4. Move listing order into the service layer.

Rollback is a straight revert at any step; nothing on disk changes shape, so a downgraded build reads the
same rows it wrote. The only user-visible regression on rollback is that labels written as `stable` while
the change was deployed become unresolvable again — they remain in the database and reappear when the
change is re-applied.

**Relationship to PR #497:** that PR's `toVersionCandidate` gating survives and is extended by D3; its
`selectStoredVersion` tie-break is superseded by D4 rung 1 and should be removed rather than layered on.

## Open Questions

- Whether the web UI should suggest a library's existing tags in its version field. Presentation only; it
  does not affect the specs, the ladder, or the task breakdown.
- Whether `list_libraries` should mark which labels are tags rather than versions. Additive to the
  response shape and safely deferrable.
