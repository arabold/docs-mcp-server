# Superseded

This change introduced the original promptfoo-based search evaluation
(`npm run evaluate:search`, the 5-query React-only `dataset.yaml`,
`gpt-4o-mini` as judge). It shipped to code but its spec was never
archived into `openspec/specs/search-evaluation/`.

It has been superseded by:

- **[define-search-benchmark](../define-search-benchmark/)**

That change defines `search-evaluation` as the live spec from a clean
slate, replacing every requirement that would have come from this
change's `specs/search-evaluation/spec.md`. The dataset, judge model,
metrics, and regression behaviour all differ — see
`../define-search-benchmark/proposal.md` for the breakdown.

Do not archive this change directly: doing so would write a stale
`openspec/specs/search-evaluation/spec.md` that conflicts with
`define-search-benchmark`. Instead, remove this directory once
`define-search-benchmark` is archived.
