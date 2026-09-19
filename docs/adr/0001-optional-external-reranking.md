---
status: accepted
---

# Use optional external reranking before context assembly

When reranking is enabled, search sends the Search Query and Search Candidates
to Voyage before Context Assembly and uses the returned relevance scores. The
change stays isolated from the database and index so it can remain a small fork
patch and later become an upstream contribution.

The first release uses the official Voyage endpoint and `rerank-2.5-lite`
behind a small provider-neutral Reranker interface. Voyage is the first adapter,
while the Reranker interface remains universal. Equal relevance scores keep
Baseline Ranking, and Context Assembly continues to combine nearby candidates
from the same page.
The shared configuration defaults reranking to off, while the production
deployment explicitly enables it and supplies its existing credential.

The initial candidate limit is configurable and defaults to 30. The live
benchmark compares 30 and 50 candidates across the same 40 Search Queries, and
production uses 50 only when it gives a material quality improvement; an
equivalent result keeps 30.

The process that executes search owns the Voyage credential. Missing startup
credentials stop that process, while runtime errors, incomplete responses, or
the five-second request deadline use Fail-open Search. Voyage receives every
input in full, and logs contain only safe operational metadata.
After three consecutive runtime failures, search pauses Voyage requests for one
minute and uses Fail-open Search immediately during that pause. A valid response
resets the failure count. After the pause, one Search Query probes Voyage while
concurrent queries continue to use Fail-open Search. These pause values are
fixed in the first release, and searches bypass local Voyage queuing.

The existing 40-query live benchmark gates production deployment after local
verification. It requires zero unexpected Voyage failures, Recall@30 at least
equal to Baseline Ranking, the Q30 target among Search Candidates, and MRR and
nDCG@5 of at least 0.90. Once the gate passes, production starts with reranking
enabled.
The first release keeps reranking configuration-only and stateless. The existing
local-versus-remote search limit difference remains the current behavior.

Deployment preserves the previous immutable image and Compose configuration.
Production receives one normal Voyage-backed smoke search; failure behavior is
tested in a separate safe instance. A failed production check rolls back to the
previous image and reuses the existing index.
