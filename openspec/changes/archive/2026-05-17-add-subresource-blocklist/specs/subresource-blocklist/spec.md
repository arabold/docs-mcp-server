## ADDED Requirements

### Requirement: Blocklist categories and scope

The scraper SHALL maintain a built-in, hand-curated blocklist of third-party sub-resource origins covering exactly these categories: **Analytics**, **Session Replay**, **Chat Widgets**, **Captcha**, and **Social Embed runtimes**. The list SHALL contain between 20 and 60 entries total. Each entry SHALL be grouped under exactly one of these five categories.

#### Scenario: Analytics SDK request is blocked
- **GIVEN** a page renders under Playwright and requests `https://www.google-analytics.com/analytics.js`
- **WHEN** the route interceptor evaluates the request
- **THEN** the request is aborted with Playwright reason `blockedbyclient`
- **AND** no bytes are downloaded
- **AND** a `debug`-level log entry records the block with the category `Analytics`

#### Scenario: Captcha runtime is blocked
- **GIVEN** a page requests `https://newassets.hcaptcha.com/c/<hash>/hsw.js`
- **WHEN** the route interceptor evaluates the request
- **THEN** the request is aborted with reason `blockedbyclient`
- **AND** no bytes are downloaded

#### Scenario: Chat widget bundle is blocked
- **GIVEN** a page requests `https://widget.kapa.ai/kapa-widget.bundle.js`
- **WHEN** the route interceptor evaluates the request
- **THEN** the request is aborted with reason `blockedbyclient`

#### Scenario: Session replay agent is blocked
- **GIVEN** a page requests a resource under a session-replay vendor host listed in the blocklist (e.g. `static.hotjar.com/c/hotjar-12345.js`)
- **WHEN** the route interceptor evaluates the request
- **THEN** the request is aborted with reason `blockedbyclient`

### Requirement: Hostname-suffix matching with boundary

Blocklist hostname entries SHALL match a request host when the request host equals the entry or ends with `.<entry>`. A bare substring match SHALL NOT match across a domain-label boundary.

#### Scenario: Exact host match
- **GIVEN** the blocklist contains `google-analytics.com`
- **WHEN** a request targets host `google-analytics.com`
- **THEN** the request is blocked

#### Scenario: Subdomain match
- **GIVEN** the blocklist contains `google-analytics.com`
- **WHEN** a request targets host `www.google-analytics.com`
- **THEN** the request is blocked

#### Scenario: Suffix collision is rejected
- **GIVEN** the blocklist contains `google-analytics.com`
- **WHEN** a request targets host `evil-google-analytics.com`
- **THEN** the request is NOT blocked by the blocklist

#### Scenario: Unrelated host with similar tail is rejected
- **GIVEN** the blocklist contains `analytics.com`
- **WHEN** a request targets host `myanalytics.com`
- **THEN** the request is NOT blocked by the blocklist

### Requirement: Optional path-prefix qualification

A blocklist entry MAY specify a path prefix in addition to the hostname. When a path prefix is specified, the entry SHALL match only when both the hostname rule above is satisfied AND the request URL's pathname starts with the configured prefix.

#### Scenario: YouTube embed runtime is blocked but embed document is not
- **GIVEN** the blocklist contains an entry for host `youtube-nocookie.com` with path prefix `/s/_/ytembeds/`
- **WHEN** a request targets `https://www.youtube-nocookie.com/s/_/ytembeds/_/js/k=ytembeds.base.en_US.<hash>/m=r78Drb`
- **THEN** the request is blocked
- **AND** when a request targets `https://www.youtube-nocookie.com/embed/<videoId>`
- **THEN** the request is NOT blocked

### Requirement: Explicit category exclusions

The blocklist SHALL NOT include entries for advertising-network domains nor for generic content-delivery-network hosts that serve runtime libraries pages may legitimately use to render documentation content.

#### Scenario: Advertising network is not blocked
- **GIVEN** the blocklist does not contain an entry covering `doubleclick.net`, `googlesyndication.com`, or `googleadservices.com`
- **WHEN** a page requests `https://googleads.g.doubleclick.net/pagead/ads`
- **THEN** the blocklist does NOT abort the request
- **AND** the request proceeds through the remaining route-interception pipeline (resource-type abort, caching, fetch)

#### Scenario: Generic CDN serving a content library is not blocked
- **GIVEN** the blocklist does not contain an entry covering `unpkg.com`, `cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `cdn.skypack.dev`, or `esm.sh`
- **WHEN** a page requests `https://unpkg.com/mermaid@11/dist/mermaid.min.js`
- **THEN** the blocklist does NOT abort the request

### Requirement: Order relative to other request gates

The sub-resource blocklist SHALL be evaluated in the route-interception pipeline strictly after the outbound access-policy check and strictly before the resource-type abort and any cache lookup. The blocklist branch SHALL first short-circuit on `resourceType === "document"` (see the document-type exemption requirement below) and only then consult the blocklist data. The blocklist SHALL NOT override an access-policy reject.

#### Scenario: Access policy reject takes precedence
- **GIVEN** the outbound access policy is configured to block private network targets
- **AND** a request targets a private IP whose hostname also matches a blocklist entry
- **WHEN** the route interceptor evaluates the request
- **THEN** the request is rejected by the access-policy gate
- **AND** no blocklist log entry is emitted

#### Scenario: Blocklist runs before resource-type abort
- **GIVEN** the blocklist contains `google-analytics.com`
- **AND** a page requests `https://www.google-analytics.com/collect.gif` (an analytics beacon delivered as an image)
- **WHEN** the route interceptor evaluates the request
- **THEN** the request is aborted under the blocklist
- **AND** the abort is logged with the blocklist category, not as a generic image abort

#### Scenario: Blocklist runs before cache lookup
- **GIVEN** a blocked host's response is somehow already present in the sub-resource cache
- **WHEN** the route interceptor evaluates a new request for that URL
- **THEN** the request is aborted under the blocklist
- **AND** the cached body is NOT served

### Requirement: Document-type requests are exempt

The blocklist SHALL NOT be consulted for any request whose Playwright `resourceType` is `document`. This exempts the top-level navigation of a scrape job and any iframe document navigations, while still applying the blocklist to every non-document sub-resource those documents subsequently load (scripts, XHR, images, stylesheets, fetch, etc.).

#### Scenario: User-requested scrape of a host that appears on the blocklist
- **GIVEN** the blocklist contains `google-analytics.com`
- **AND** a user invokes a scrape with start URL `https://google-analytics.com/somedocs`
- **WHEN** the top-level navigation request is intercepted
- **THEN** Playwright reports the request's `resourceType` as `document`
- **AND** the blocklist does NOT abort the request
- **AND** the page is fetched and processed normally

#### Scenario: Iframe document navigation to a blocklisted host is allowed
- **GIVEN** the blocklist contains `widget.kapa.ai`
- **AND** a page embeds an `<iframe src="https://widget.kapa.ai/embed">`
- **WHEN** Playwright requests the iframe document
- **THEN** the request's `resourceType` is `document`
- **AND** the blocklist does NOT abort the iframe document request

#### Scenario: Scripts loaded inside an allowed iframe are still blocked
- **GIVEN** the blocklist contains `widget.kapa.ai`
- **AND** the iframe document from the previous scenario loads `https://widget.kapa.ai/kapa-widget.bundle.js`
- **WHEN** that script request is intercepted
- **THEN** the request's `resourceType` is `script` (not `document`)
- **AND** the blocklist aborts the request with reason `blockedbyclient`

### Requirement: Single boolean kill switch

The blocklist SHALL be governed by exactly one user-facing configuration key, `scraper.skipKnownTrackers`, a boolean defaulting to `true`. When the value is `true`, the blocklist branch in the route-interception pipeline is evaluated for every sub-resource. When the value is `false`, the blocklist branch is skipped entirely and sub-resources proceed to the remaining gates (resource-type abort, cache lookup, fetch) as if the blocklist were not present.

No other configuration key SHALL allow callers to add to, remove from, or otherwise modify the contents of the built-in blocklist in v1. The existing `excludePatterns` SHALL continue to govern only discovered crawl URLs and SHALL NOT influence sub-resource filtering.

#### Scenario: Default-on blocks a tracker request
- **GIVEN** `scraper.skipKnownTrackers` is at its default value
- **WHEN** a page requests `https://www.google-analytics.com/analytics.js`
- **THEN** the request is aborted with reason `blockedbyclient`

#### Scenario: Disabling the flag bypasses the blocklist
- **GIVEN** `scraper.skipKnownTrackers` is set to `false`
- **WHEN** a page requests `https://www.google-analytics.com/analytics.js`
- **THEN** the blocklist does NOT abort the request
- **AND** the request proceeds through the remaining route-interception pipeline

#### Scenario: Disabling the flag does not affect other gates
- **GIVEN** `scraper.skipKnownTrackers` is set to `false`
- **AND** the outbound access policy is configured to reject a particular target
- **WHEN** a page requests that target
- **THEN** the access-policy reject still applies
- **AND** the request is aborted by the access-policy gate

#### Scenario: excludePatterns remains unaffected
- **GIVEN** a user supplies `excludePatterns: ["**/widget.kapa.ai/**"]`
- **WHEN** the scraper resolves the pattern set
- **THEN** `excludePatterns` continues to filter discovered crawl URLs only
- **AND** sub-resource blocking is governed exclusively by `scraper.skipKnownTrackers` and the built-in list

### Requirement: Logging

Blocked sub-resource requests SHALL be logged at `debug` level only, with a message that identifies both the URL and the matched category. Blocked requests SHALL NOT produce `info`, `warn`, or `error` log output, and SHALL NOT produce any `console.*` output.

#### Scenario: Debug log is emitted on block
- **GIVEN** the logger level is `debug`
- **WHEN** a sub-resource is blocked
- **THEN** exactly one log entry is emitted at `debug` level containing the request URL and the blocklist category

#### Scenario: Higher log levels remain silent
- **GIVEN** the logger level is `info` or higher
- **WHEN** a sub-resource is blocked
- **THEN** no log entry is emitted for that block
