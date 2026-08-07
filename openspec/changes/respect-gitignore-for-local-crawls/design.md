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
only — it never reads a file outside the indexed folder — and a failure to
resolve an ancestor is treated as "no repository", never as a crawl error.

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
rewrites: the test suite compares the filter's verdicts against real `git`
behaviour across the pattern forms that the rewriting touches.

## Case sensitivity

Git decides case-insensitive matching from `core.ignoreCase`, which it sets by
probing the filesystem at clone time. The filter performs the equivalent probe —
whether `.GITIGNORE` and `.gitignore` resolve to the same inode — so a crawl on a
case-insensitive volume matches the way Git on that volume does, without reading
Git configuration.

## Symlinks

A symlink is tested as a plain path first, so a rule naming it skips it without
ever resolving the target. Only when that does not match is the target resolved,
and only to answer whether a directory-only rule applies. Testing both forms up
front would be cheaper but would skip a symlink pointing at a *file* whose name
matches a directory-only rule, which Git does not do.

Symlinks are only resolved at all when the security policy allows following
them; otherwise a link that is not matched by a path rule is simply kept.

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
