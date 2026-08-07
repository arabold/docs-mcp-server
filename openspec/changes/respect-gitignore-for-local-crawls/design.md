# Design: .gitignore filtering for local crawls

## Scope boundary: the indexed folder, not the repository

Git resolves ignore rules against the repository root and layers on
`.git/info/exclude` plus the user's global excludes. This change evaluates only
`.gitignore` files at or below the indexed folder.

The reason is the access policy. `file://` crawls are constrained to configured
allowed roots, and reading rule files from ancestor directories would read
outside the folder the user pointed at — a boundary the security model exists to
enforce. Silently widening it for the convenience of one option is the wrong
trade.

The cost is that indexing a subdirectory of a repository indexes files that
repository's own `.gitignore` excludes. That is the behaviour most likely to
surprise, so the crawl probes upward for a `.git` entry and logs a warning
naming the repository root when it finds one. The probe is an existence check
only — it never reads a file outside the indexed folder — and an ancestor it
cannot read is stepped over rather than ending the walk, so a diagnostic can
never fail a crawl.

## Rule evaluation: pattern rewriting over per-directory matchers

Each `.gitignore` establishes a base directory for its patterns. Rather than
carrying a matcher plus a base per directory and combining their verdicts, this
implementation rewrites nested patterns into root-relative form and appends them
to the matcher inherited from the parent directory. Ordering then falls out of
`ignore`'s own last-match-wins semantics, which is exactly Git's rule.

Two properties keep this cheap. A directory with no `.gitignore` reuses its
parent's matcher object rather than rebuilding one, so only directories that
actually carry rules allocate. And every directory's context is cached as a
promise for the life of the crawl, so a path's ancestors are resolved once no
matter how many entries are tested beneath them.

Git's "a re-include cannot resurrect a file under an excluded directory" rule
does not fall out of pattern ordering, so it is modelled explicitly: building a
directory's context checks whether the parent's matcher excludes that directory,
and if so the context is marked blocked and every descendant is ignored without
consulting patterns at all.

Correctness here is verified differentially rather than by reasoning about the
rewrites. `gitignore.test.ts` builds throwaway repositories, walks them with the
same prune-ignored-directories rule the crawler uses, and compares the resulting
file set against `git ls-files --others --exclude-standard` — over both a curated
set of pattern forms and a deterministic generated corpus.

Its scope is the rewriting and the cascade, and nothing else: the walk models
directory pruning over regular files, not symlinks, hidden-file filtering,
archives, or the refresh-time re-check. Those are pinned by the strategy and
end-to-end tests instead.

## Case sensitivity

Git decides case-insensitive matching from `core.ignoreCase`, which it sets by
probing the filesystem at clone time. The filter performs the equivalent probe —
whether `.GITIGNORE` and `.gitignore` resolve to the same inode — so a crawl on a
case-insensitive volume matches the way Git on that volume does, without reading
Git configuration.

The `.git` name is the exception: it is matched case-insensitively regardless.
Git guards that spelling itself on case-insensitive volumes rather than deferring
to `core.ignoreCase`, and skipping an unrelated `.GIT` directory on a
case-sensitive volume is a far cheaper mistake than indexing a repository's
internals. Only the case dimension is covered — Git also rejects `git~1`,
`.git.` and other filesystem-specific spellings, which a crawl is unlikely to
meet.

## Symlinks

Git records a symlink as a blob, never as a directory. A directory-only rule
(`link/`) therefore never matches one, however it resolves — only a plain path
rule (`link`) does. Verified with `git check-ignore`: with `linkdir/` in
`.gitignore`, a `linkdir` symlink pointing at a real directory is reported as
not ignored.

Testing links as paths falls out of that, and carries a second benefit: a
gitignored link is skipped without its target ever being resolved, so a rule
naming a link is enough to keep the crawler away from whatever it points at.

The contents of a followed symlink to a directory are still pruned by a
directory-only rule naming the link, because the enclosing directory is matched
as a directory when its rule context is built. The net effect matches Git
closely: Git lists the link itself and never descends; the crawler descends but
indexes nothing inside.

## Refresh semantics

Refresh jobs seed the queue from the database rather than from directory
enumeration, so pruning at enumeration time cannot see them. Ignored paths are
therefore also checked when an item is processed, and a previously indexed page
that is now ignored reports as not-found so the existing refresh-deletion path
removes it. A path that was never indexed reports success with no content, which
contributes nothing and does not count against the page budget.

Archive members have no filesystem entry of their own, so the physical archive
file carries the decision for everything inside it.

## Alternatives considered

**Shelling out to `git check-ignore`.** Exact by construction, but requires a
Git binary in every deployment including the container image, costs a process
per batch of paths, and answers a slightly different question than traversal
needs: `check-ignore` reports a trailing-slash directory form as ignored for
`dir/**` patterns, which would over-prune directories whose direct children Git
still lists.

**Folding the check into `shouldProcessUrl`.** That hook is synchronous and
shared with web strategies; rule evaluation needs filesystem reads and is
meaningless for HTTP URLs.

**Reading ancestor rules anyway.** Rejected on the access-policy grounds above.
