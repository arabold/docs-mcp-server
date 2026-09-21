## ADDED Requirements

### Requirement: Pipeline capability predicate is the single source of truth

The system SHALL expose a single predicate that answers whether any configured content pipeline can process a given MIME type. The predicate SHALL be derived from the pipeline set produced by `PipelineFactory.createStandardPipelines()` by consulting each pipeline's own `canProcess()` with the MIME type and no content argument. Every gate that filters on content type SHALL consult this predicate. No gate SHALL maintain its own list of processable or unprocessable MIME types, and no gate SHALL hardcode individual extensions or MIME strings.

Because the predicate is evaluated without content, it SHALL be at least as permissive as the pipeline-selection loop that runs later with content available. A resource the predicate accepts MAY still be refused by a pipeline; a resource the predicate rejects SHALL NOT have been accepted by any pipeline.

#### Scenario: HTML is processable
- **WHEN** the predicate is evaluated for `text/html`
- **THEN** it returns true because `HtmlPipeline` claims the type

#### Scenario: PDF is processable
- **WHEN** the predicate is evaluated for `application/pdf`
- **THEN** it returns true because `DocumentPipeline` claims the type

#### Scenario: Source code is processable
- **WHEN** the predicate is evaluated for `text/x-python`
- **THEN** it returns true because `SourceCodePipeline` claims the type

#### Scenario: Raster images are not processable
- **WHEN** the predicate is evaluated for `image/png`, `image/jpeg`, or `image/gif`
- **THEN** it returns false for each

#### Scenario: SVG is not processable
- **WHEN** the predicate is evaluated for `image/svg+xml`
- **THEN** it returns false because no pipeline claims the type
- **AND** no rule names SVG explicitly

#### Scenario: Unknown binary content is not processable
- **WHEN** the predicate is evaluated for `application/octet-stream`
- **THEN** it returns false

#### Scenario: Adding a pipeline widens both gates
- **GIVEN** a new pipeline is added to `PipelineFactory.createStandardPipelines()` whose `canProcess()` claims `image/svg+xml`
- **WHEN** the predicate is evaluated for `image/svg+xml`
- **THEN** it returns true
- **AND** both the queue-time and fetch-time gates admit SVG resources with no further change

### Requirement: Queue-time rejection of links naming unprocessable binary media

When filtering a discovered link, the scraper SHALL detect a MIME type from the link's **pathname** using `MimeTypeUtils.detectMimeTypeFromPath()`. The link SHALL be rejected and SHALL NOT be enqueued only when **both** of the following hold:

1. the detected type names binary media — an `image/*`, `video/*`, `audio/*`, or `font/*` type; and
2. the capability predicate returns false for it.

When detection returns null, or the detected type is not binary media, the link SHALL proceed to the remaining filters unchanged and the decision is deferred to the fetch-time gate.

The two conditions answer different questions and SHALL remain separate. The binary-media check decides how far a file extension may be trusted before a request is made; the capability predicate decides what can be processed. In particular, `application/*` types SHALL NOT be treated as binary media, because the `mime` package resolves plain-text scripts such as `.csh`, `.tcl`, `.bat`, `.scm` and `.ps` to `application/*` types that pipelines read without difficulty.

Query strings and fragments SHALL NOT participate in detection, so a URL whose query mentions a file extension is not rejected on that basis. A dot appearing only within a directory segment SHALL NOT be read as a file extension.

#### Scenario: Image link is rejected before any request
- **WHEN** a discovered link is `https://example.com/docs/diagram.png`
- **THEN** the link is rejected
- **AND** no HTTP request is issued for it
- **AND** it is not added to the crawl queue

#### Scenario: Document link is admitted
- **WHEN** a discovered link is `https://example.com/docs/guide.pdf`
- **THEN** the link is not rejected by this gate

#### Scenario: Script extensions the mime package misclassifies are admitted
- **WHEN** a discovered link ends in `.csh`, `.tcl`, `.bat`, `.scm`, or `.ps`
- **AND** detection resolves it to an `application/*` type no pipeline claims
- **THEN** the link is not rejected by this gate, because the type is not binary media
- **AND** the decision is deferred to the fetch-time gate, which sees the served `Content-Type`

#### Scenario: Unprocessable non-media type is deferred, not rejected
- **WHEN** a discovered link is `https://example.com/tool.jar`
- **AND** detection resolves it to an `application/*` type no pipeline claims
- **THEN** the link is not rejected by this gate
- **AND** the fetch-time gate aborts it once the response headers arrive

#### Scenario: A dot inside a directory segment is not an extension
- **WHEN** a discovered link is `https://example.com/docs/v1.0/guide`
- **THEN** detection returns null
- **AND** the link is not rejected by this gate

#### Scenario: Extensionless link is admitted
- **WHEN** a discovered link is `https://example.com/docs/getting-started`
- **AND** `detectMimeTypeFromPath()` returns null for it
- **THEN** the link is not rejected by this gate
- **AND** it is enqueued so the fetch-time gate can decide

#### Scenario: Unrecognised extension is admitted
- **WHEN** a discovered link is `https://example.com/tools/script.qbas`
- **AND** `detectMimeTypeFromPath()` returns null for it
- **THEN** the link is not rejected by this gate

#### Scenario: Query string does not trigger rejection
- **WHEN** a discovered link is `https://example.com/download?file=diagram.png`
- **THEN** detection operates on the pathname `/download` only
- **AND** the link is not rejected by this gate

#### Scenario: Rejected links do not enter discovery counts
- **WHEN** a link is rejected by this gate
- **THEN** it is not counted toward `totalDiscovered` or `effectiveTotal`

### Requirement: Fetch-time abort on unprocessable response content type

For HTTP responses with a success status, the fetcher SHALL evaluate the resolved MIME type against the capability predicate after redirect resolution and after the outbound access-policy check for the final URL, and before the response body is consumed. When the predicate returns false, the fetcher SHALL abort the response without reading the body to completion and SHALL report the resource with a status distinct from success, not-modified, and not-found.

The gate SHALL NOT be consulted for `304 Not Modified` or `404 Not Found` responses, whose reported MIME types do not describe stored content.

#### Scenario: Image response is aborted at the headers
- **GIVEN** a queued URL with no extension
- **WHEN** the server responds `200` with `Content-Type: image/png`
- **THEN** the response body is not downloaded to completion
- **AND** the resource is reported as skipped
- **AND** no page content is produced

#### Scenario: HTML response proceeds normally
- **WHEN** the server responds `200` with `Content-Type: text/html`
- **THEN** the body is read in full and processed by the pipelines as before

#### Scenario: Missing Content-Type is treated as unprocessable
- **GIVEN** a response with no `Content-Type` header
- **WHEN** `MimeTypeUtils.parseContentType()` resolves it to `application/octet-stream`
- **THEN** the predicate returns false
- **AND** the response is aborted
- **AND** this matches the existing outcome, where no pipeline would have accepted the content

#### Scenario: Extension and served type disagree
- **GIVEN** a discovered link `https://example.com/docs/report` that the queue-time gate admitted
- **WHEN** the server responds with `Content-Type: application/zip`
- **THEN** the response is aborted by this gate

#### Scenario: Redirect chain ending at an image
- **GIVEN** a queued URL that responds `301` to a second URL serving `image/jpeg`
- **WHEN** the fetcher follows the redirect
- **THEN** the access policy is asserted for the redirect target as it is today
- **AND** the gate is evaluated against the final response's `Content-Type`
- **AND** the response is aborted

#### Scenario: Conditional request is exempt
- **GIVEN** a refresh request carrying an `If-None-Match` header
- **WHEN** the server responds `304 Not Modified`
- **THEN** the gate is not consulted
- **AND** the existing not-modified handling applies unchanged

#### Scenario: Deleted page is exempt
- **WHEN** the server responds `404 Not Found`
- **THEN** the gate is not consulted
- **AND** the existing not-found handling applies unchanged

### Requirement: Fetcher receives capability as an injected predicate

The fetcher SHALL NOT depend on the pipeline layer. The capability predicate SHALL be supplied to the fetcher through its fetch options by the calling strategy, which owns both the fetcher and the pipeline set. When no predicate is supplied, the fetcher SHALL NOT apply the fetch-time gate.

#### Scenario: Strategy injects the predicate
- **WHEN** `WebScraperStrategy` fetches a queued URL
- **THEN** it passes the capability predicate built from its own pipeline set in the fetch options

#### Scenario: Fetcher without a predicate does not gate
- **GIVEN** a caller that supplies no predicate in its fetch options
- **WHEN** the fetcher receives a response with any `Content-Type`
- **THEN** no fetch-time gating occurs
- **AND** the body is read in full

#### Scenario: Fetcher has no pipeline imports
- **WHEN** the fetcher module's dependencies are inspected
- **THEN** it imports nothing from the pipeline layer

### Requirement: Skipped resources are neither content nor failures

A resource rejected by either gate SHALL be logged at `debug` level with the resource URL and the MIME type that caused the rejection. Skipped resources SHALL NOT produce `info`, `warn`, or `error` log output, and SHALL NOT produce any `console.*` output. A skipped resource SHALL NOT produce a stored page, and SHALL NOT be recorded as a page failure.

#### Scenario: Debug log records the reason
- **GIVEN** the logger level is `debug`
- **WHEN** a resource is skipped by either gate
- **THEN** exactly one `debug` entry is emitted naming the URL and the rejecting MIME type

#### Scenario: Higher log levels stay silent
- **GIVEN** the logger level is `info` or higher
- **WHEN** a resource is skipped
- **THEN** no log entry is emitted for that skip

#### Scenario: Skipped resource produces no page
- **WHEN** a resource is skipped
- **THEN** no document is stored for it
- **AND** no progress event reports content for it

### Requirement: The gates are unconditional

The queue-time and fetch-time gates SHALL NOT be governed by any configuration key. No configuration value SHALL disable either gate, add types to the processable set, or remove types from it. The set of processable types is determined solely by the configured pipelines.

#### Scenario: No configuration key governs filtering
- **WHEN** the configuration schema is inspected
- **THEN** it contains no key that enables, disables, or parameterises either gate

#### Scenario: Exclude patterns remain a crawl-shape control
- **GIVEN** a user supplies `excludePatterns`
- **WHEN** the scraper resolves the pattern set
- **THEN** `excludePatterns` continues to govern crawl shape only
- **AND** it neither widens nor narrows the set of processable content types
