## Context

The crawler decides what it can read only after it has already paid for the bytes. A discovered link is filtered for scope and patterns, enqueued, dequeued, fetched in full, and only then offered to the pipelines — which may refuse it, at which point the content is dropped.

```
  TODAY — the decision happens at the last possible moment

  <a href="…/flamegraph.png">
         │
         ▼
  ┌─────────────────────────────────────────┐
  │ discovered-link filter                   │  archive ext? scope? patterns?
  │ WebScraperStrategy.ts:412                │  png passes all three
  └─────────────────┬───────────────────────┘
                    ▼
              [ enqueued ]  ── counted into totalDiscovered / effectiveTotal
                    │
                    ▼
  ┌─────────────────────────────────────────┐
  │ HttpFetcher — responseType 'arraybuffer' │  1.05 MB downloaded
  └─────────────────┬───────────────────────┘
                    ▼
  ┌─────────────────────────────────────────┐
  │ for (pipeline of pipelines)              │
  │   pipeline.canProcess('image/png') ✗     │  nothing claims it
  └─────────────────┬───────────────────────┘
                    ▼
              [ discarded ]                     881 times on one site
```

The knowledge needed to reject the link is present at step one — `.png` is not something any pipeline reads — but it lives in six separate `canProcess()` methods that nothing consults until the last step.

## Goals / Non-Goals

**Goals**

- Stop fetching resources no pipeline can read.
- Keep the definition of "can read" in exactly one place, owned by the pipelines.
- Preserve the indexed output. The system should end up with the same documents, having done less work.
- Make adding a future pipeline (SVG, images with OCR, video transcripts) automatically widen what the crawler will fetch, with no second list to update.

**Non-Goals**

- Redefining the progress counters. They will shift as a side effect, and `define-scrape-progress-semantics` handles the semantics.
- Filtering Playwright sub-resources. `subresource-blocklist` already covers that layer and is unaffected.
- Adding a user-facing allow-list or deny-list of content types.
- Changing which formats the system can read. This change makes the existing answer cheaper to obtain, nothing more.

## Decisions

### Decision: One predicate, derived from the pipelines

The gates ask the pipelines rather than consulting a list:

```
  ┌────────────────────────────────────────────────────────┐
  │  canAnyPipelineProcess(mimeType): boolean              │
  │                                                        │
  │  pipelines.some(p => p.canProcess(mimeType))           │
  │      built from PipelineFactory.createStandardPipelines│
  └────────────────────────────────────────────────────────┘
        ▲                                    ▲
        │                                    │
   queue-time gate                     fetch-time gate
   (path extension)                    (response Content-Type)
```

This satisfies the existing `mime-type-detection` rule that MIME knowledge has a single home, and it means the SVG decision is expressed by the absence of a pipeline rather than by an entry in a list.

`canProcess(mimeType, content?)` takes an optional content argument that `TextPipeline` uses for null-byte binary detection. Neither gate has content available, so both call it with the MIME type alone. Omitting the second argument only makes the predicate *more* permissive than the pipeline loop, which is the safe direction: a resource the predicate allows may still be refused later, but nothing the predicate rejects would have been accepted.

### Decision: Two gates, not one

Neither gate is sufficient alone.

```
                      what each gate can see          what it misses
  ─────────────────────────────────────────────────────────────────────
  queue-time     URL path extension only         extensionless URLs
  (free)         /Perf/tools.png → image/png     /Perf/tools → null

  fetch-time     the server's Content-Type       nothing, but costs
  (1 RTT)        authoritative                   a request to find out
```

In the measured crawl, 881 of 1087 discarded resources had an honest image extension and 118 had no extension at all. The queue-time gate handles the bulk for free; the fetch-time gate is the correctness backstop.

The queue-time gate acts only when `detectMimeTypeFromPath()` returns a type. Null means "no opinion", and the link is queued so the fetch-time gate can decide with real information.

**It also acts only on binary media.** Implementation measured the draft gate against the 806 pages the reference crawl indexes today and found it would discard five of them, including `/Guess/guess.ps` — a URL named in issue #490:

```
  detected                             served        reality
  ───────────────────────────────────  ────────────  ─────────────────
  application/x-csh                    text/plain    C shell script
  application/x-tcl                    text/plain    Tcl script
  application/x-msdownload             text/plain    batch script
  application/vnd.lotus-screencam      text/plain    Scheme source
  application/postscript               text/plain    PostScript source
```

Every casualty is a text script the `mime` package files under `application/*`. So the extension is trustworthy for pre-request rejection only when it names binary media, and the gate takes two conditions:

```
  reject  ⟺  isBinaryMediaType(mime)  &&  !canProcessMimeType(mime)
                     │                            │
            how far to trust           what can be processed
            the extension              (still the predicate, so adding
                                        an image pipeline widens the
                                        gate automatically)
```

These stay separate because they answer different questions, and the second is still the shared predicate — the gate gains a confidence rule, not a second capability list. Re-measured against the same crawl: **zero indexed pages lost, 882 of 1087 wasted fetches still caught for free**, with the remaining 205 deferred to the fetch-time gate.

The residual risk from `design.md`'s original framing shrinks accordingly. A rejection now requires an `image/*`, `video/*`, `audio/*` or `font/*` extension on a URL that serves something else, which is a much narrower claim than "any extension may lie".

### Decision: GET with early abort, not HEAD

A HEAD probe was considered and rejected. `HttpFetcher` sets `maxRedirects: 0` and walks redirects itself so that `accessPolicy.assertNetworkUrlAllowed()` runs on every hop, and it generates a fresh anti-bot fingerprint per request.

```
  HEAD → GET                              GET + abort
  ──────────────────────────────          ──────────────────────────────
  HEAD  /a  → 301 → /b → image/png        GET /a → 301 → /b
  (redirect walk #1, fingerprint #1)             headers: image/png
                                                 → destroy the stream
  GET   /a  → 301 → /b → image/png
  (redirect walk #2, fingerprint #2)      one walk, one fingerprint,
                                          one conditional request
  two walks that may diverge;
  two mismatched fingerprints to
  the same origin;
  405 / 501 / Content-Type that
  disagrees with the GET
```

For 2158 URLs, HEAD-then-GET is roughly 2964 requests against 2158, and every indexed page costs two round trips instead of one. The aborted-stream approach wastes at most one socket buffer per rejected resource — about 6% of a 1 MB image — and cannot be lied to, because it reads the headers of the response it is actually going to use.

The cost is that an aborted keep-alive connection cannot be reused, so each rejection forces a new TCP and TLS handshake. That is bounded and predictable. HEAD returning a `Content-Type` that disagrees with the subsequent GET is neither.

Challenge detection is unaffected: `HttpFetcher.ts:321` decides on status codes, not response bodies, so the Cloudflare fallback in `AutoDetectFetcher` behaves identically under a streaming response.

### Decision: The fetcher is told what is acceptable, it does not work it out

Only the fetcher holds the live stream, so the abort must happen there. Only the strategy owns both the fetcher and the pipelines. The capability therefore travels downward as an injected predicate:

```
  WebScraperStrategy ── owns fetcher AND pipelines
      │
      ├─ builds canAnyPipelineProcess from its own pipeline set
      │
      └─ fetcher.fetch(url, { …, acceptsMimeType: canAnyPipelineProcess })
                │
                ▼
         HttpFetcher ── reads headers, calls the predicate, aborts or streams.
                        Still knows nothing about pipelines.
```

This keeps the layering intact. The fetcher gains a parameter, not a dependency.

### Decision: Gate ordering

The fetch-time gate runs after redirect resolution and after the access-policy check on the final URL, so a redirect chain ending at an image is aborted at its final hop and the access policy is never bypassed.

```
  HttpFetcher.fetch
      │
      ├─ assertNetworkUrlAllowed(source)         existing
      ├─ request, follow redirects manually      existing
      │     └─ assertNetworkUrlAllowed(hop)      existing, per hop
      ├─ 304? → NOT_MODIFIED, gate not consulted     ← see below
      ├─ assertNetworkUrlAllowed(finalUrl)       existing
      ├─ acceptsMimeType(contentType)?           NEW
      │     ├─ no  → destroy stream, FetchStatus.SKIPPED
      │     └─ yes → accumulate body, SUCCESS
      └─ …
```

Non-200 responses are not subject to the gate. A 304 currently reports a synthetic `text/plain` MIME type (`HttpFetcher.ts:170`) that has nothing to do with the stored content, and a 404 carries no meaningful type either. Both keep their existing statuses.

### Decision: Skipped is a third outcome, not a failure

`BaseScraperStrategy` currently sorts results into success, not-modified, not-found, and thrown errors, with the last feeding `abortOnFailureRate` (default 0.5). A skipped resource is none of these. If skips were counted as failures, a site where more than half the links point at images would abort mid-crawl even though every page it did read succeeded.

Skips are therefore a distinct `FetchStatus` that produces no content, no page record, and no failure tally — logged at `debug` with the URL and the rejecting MIME type, following the precedent set by `subresource-blocklist`.

### Decision: No configuration flag

The fetch-time gate evaluates the same predicate the pipeline loop already evaluates, on the same input. `MimeTypeUtils.parseContentType()` returns `application/octet-stream` when the header is absent, so there is no response whose type is empty and no path where the gate rejects something the pipelines would have accepted. Disabling it would yield a byte-identical index, more slowly. A flag whose "off" position has no benefit is not worth the permanent surface of a config key, an env var, a schema entry, migration handling, and documentation.

The archive-extension filter sets the precedent: it sits in the same chain, rejects links unconditionally, and has never needed a switch.

Diagnosis is handled by the debug log rather than by a flag. "Skipped …/foo.png: image/png is not processable" answers the support question directly, and a user does not have to know a flag exists to benefit from it.

Adding a flag later is additive; removing one is breaking. The asymmetry favours starting without it.

## Risks / Trade-offs

**A URL whose media extension lies about its content is now never fetched.** This is the one behaviour change that can lose content, and it comes from the queue-time gate. A link ending `.png` that actually serves HTML is indexed today and would not be after this change.

Mitigations, in order of strength: the gate fires only when detection is confident *and* the detected type names binary media, so scripts, documents and unknown extensions are all unaffected; measured against the reference crawl the narrowed gate loses zero of the 806 indexed pages; every one of the 881 images had an honest extension; and a documentation site serving HTML from an image extension is not a pattern we have observed. It remains a real, accepted trade-off rather than an eliminated one.

**A dot in a directory segment is not read as an extension, but only incidentally.** `detectMimeTypeFromPath` returns null for `/docs/v1.0/guide`, `/node.js/api`, `/2024.01.15/post` and similar, because the token after the final dot contains a `/` and cannot match the extension table while `mime.getType` extracts from the basename. That is emergent behaviour rather than a documented contract, so it is pinned by tests against a future refactor that makes the function segment-aware in the obvious way.

**Streaming changes how every HTTP body is assembled.** The switch from `arraybuffer` to `stream` touches the success path for all fetches, not only rejected ones. The existing `decompress: true` behaviour, charset handling, and the `RawContent` shape must all survive. This is the largest source of regression risk in the change and warrants the existing fetcher test suite being run unchanged before any new tests are added.

**Aborted connections cannot be reused.** Each rejection costs a fresh TCP and TLS handshake for the next request on that slot. At ~880 rejections per large site this is measurable but small next to the 250 MB it avoids, and it disappears entirely for resources the queue-time gate catches first, which is most of them.

**The archive filter becomes partly redundant.** `detectMimeTypeFromPath('.zip')` returns `application/zip`, which no pipeline claims, so the new gate would reject archive links anyway. The archive filter stays: it is separately specified, it documents intent that does not depend on pipeline composition, and archives have a distinct depth-0 root-handling path in `WebScraperStrategy.processRootArchive`. The overlap is harmless and the two are kept as separate numbered steps for clarity.

## Open Questions

- Should the queue-time gate sit before or after the scope check? Placing it before (as drafted) matches the archive filter's position and rejects out-of-scope images with the cheaper test. Placing it after would mean scope decides first, which some readers may find more natural. No functional difference.
- ~~Does `detectMimeTypeFromPath()` operate on the pathname alone?~~ Resolved during implementation. It strips query and fragment itself, but operates on the whole string it is given, so a bare href like `https://example.zip` or `https://example.mov` resolves an archive or video type off the TLD. The caller therefore passes `new URL(link).pathname`; the shared utility is left alone because its other callers pass real file paths.

## Migration Plan

None required. No persisted state, no configuration, no schema. The change takes effect on the next scrape. Previously indexed libraries keep whatever they already contain; re-indexing a library produces the same documents as before, minus the wasted fetches.
