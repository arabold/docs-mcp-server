/**
 * Anchored rubrics for the three LLM-judged metrics.
 *
 * Each rubric defines distinguishing language for scores 1, 3, and 5 — the
 * anchors are what hold a "mini" / "flash-lite" judge to a calibrated scale.
 * Edit with care: rubric changes invalidate prior baselines and should be
 * recorded in the change log so historical baselines remain interpretable.
 */

export const CHUNK_COHERENCE_RUBRIC = `You are scoring how coherent each returned chunk is as a STANDALONE READABLE UNIT.

Score 1 — Fragmented:
  Most chunks begin or end mid-sentence, mid-list item, or mid-code-block. A
  reader landing on a chunk in isolation cannot tell what it is about without
  external context. Example: a chunk that starts with "...and then call render()."
  with no preceding context, or ends with "Below we will see how to" and nothing
  follows.

Score 3 — Mixed:
  Chunks form recognisable units (paragraphs, sections, code blocks) but some
  have rough edges — an opening sentence that references an undefined "this",
  a code block that is complete but missing its surrounding explanation, a
  heading severed from the section it introduces.

Score 5 — Self-contained:
  Every chunk reads as a complete unit. Code blocks are fully enclosed, prose
  sections include enough framing to stand alone, headings stay with their
  content. A reader landing on any single chunk can understand what concept,
  API, or example it covers without needing the neighbouring chunks.

Score only the chunks shown. Ignore retrieval relevance — that is measured
separately. Return an integer in [1,5].`;

export const CONTENT_FAITHFULNESS_RUBRIC = `You are scoring how FAITHFUL each returned chunk is to the source documentation
it claims to come from (identified by URL).

Score 1 — Distorted:
  The chunk contains text that was not present in the source, has had key
  facts altered (function signatures, parameter names, defaults, return
  types), or merges content from multiple unrelated sections in a way that
  changes meaning. The reader would draw wrong conclusions from the chunk.

Score 3 — Lossy but faithful:
  The text is genuinely from the source and not altered, but the chunking
  boundary has dropped surrounding context that materially affects meaning —
  e.g. a code example without the warning that precedes it, or an API note
  without the platform-specific caveat from the next paragraph.

Score 5 — Faithful and complete:
  Every claim in the chunk is supported by the source, no facts have been
  altered, and the chunk boundary did not strip context that would change
  how the chunk reads. Quoting or paraphrasing within the chunk is accurate.

You are scoring fidelity to the source, NOT whether the source itself is
correct. Return an integer in [1,5].`;

export const ANSWERABILITY_RUBRIC = `You are scoring whether the returned chunks, AS A SET, contain enough information
for a downstream LLM to answer the given query — without external knowledge
or further retrieval.

Score 1 — Insufficient:
  The chunks do not contain the information the query asks for, OR they
  reference it only by name without showing the API/concept/example needed
  to answer. A downstream LLM would have to guess or refuse.

Score 3 — Partial:
  The chunks contain part of what the query asks for (e.g. the API name and
  signature but not usage; the concept but not the relevant API; one of two
  things being compared). A downstream LLM could give a partial answer but
  would need to caveat the gaps.

Score 5 — Sufficient:
  The chunks contain everything needed to answer the query: the relevant
  API or concept, at least one usage example or canonical explanation, and
  any caveats a competent answer would mention. A downstream LLM could
  answer confidently with only these chunks.

Judge sufficiency, not concision — extra unrelated content does not reduce
the score as long as the necessary content is present. Return an integer
in [1,5].`;

export interface RubricSpec {
  metric: "chunk_coherence" | "content_faithfulness" | "answerability";
  prompt: string;
}

export const RUBRICS: readonly RubricSpec[] = [
  { metric: "chunk_coherence", prompt: CHUNK_COHERENCE_RUBRIC },
  { metric: "content_faithfulness", prompt: CONTENT_FAITHFULNESS_RUBRIC },
  { metric: "answerability", prompt: ANSWERABILITY_RUBRIC },
];
