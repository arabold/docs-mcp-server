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

export const CONTENT_FAITHFULNESS_RUBRIC = `You are scoring whether each returned chunk LOOKS LIKE A FAITHFUL EXCERPT of
the source documentation it claims to come from (identified by URL).

IMPORTANT — what you have:
  - You DO have the chunk text and the URL it claims to come from.
  - You DO NOT have access to the live source page. You cannot fetch it.
  - This means you are judging *plausibility and internal consistency*, not
    verified fidelity. Treat scores accordingly — do not pretend to know what
    the source actually says.

Score 1 — Implausible:
  The chunk contains text that obviously could not be the source: contradictory
  facts, mid-sentence fragments stitched together from unrelated sections,
  formatting that suggests templated boilerplate from a different page, or
  internal contradictions a real doc page would not have. Function signatures
  or parameter lists look invented (wildly inconsistent with how the library
  is known to work). The reader would draw clearly wrong conclusions.

Score 3 — Plausible but rough:
  The chunk reads like real documentation but shows signs the chunking boundary
  dropped material context — e.g. a code example without the caveat that
  immediately precedes it in a normal doc layout, an API note without its
  cross-references, or content that mixes a heading and the next section's
  intro. Internally consistent and matches what you'd expect at this URL, but
  not a clean excerpt.

Score 5 — Clean excerpt:
  The chunk reads as a self-contained, internally consistent excerpt that
  matches what a careful reader would expect to find at the claimed URL. No
  stitching artifacts, no contradictions, code and prose are not severed from
  each other. As far as can be judged without fetching the source, this is
  exactly the kind of content the documentation contains.

Caveat for the consumer of these scores: this dimension is a coarse signal,
not ground truth. A chunk can score 5 here and still mis-quote the source in
ways that would only be detected by direct comparison.

Return an integer in [1,5].`;

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
