## Context

The current scraper has two behaviors that combine poorly on unhealthy targets: HTTP fetches retry up to six times by default, and crawl processing ignores child-page errors by default when `ignoreErrors` is enabled. This gives good resilience for isolated transient failures, but it also allows a scrape to continue deep into a target that is broadly unhealthy due to authentication walls, anti-bot challenges, or persistent server-side failures.

The change needs to preserve existing fail-fast behavior for root URL failures, reduce wasted time on repeated child-page failures, and keep the configuration surface small. The user preference is to avoid exposing many related knobs.

## Goals / Non-Goals

**Goals:**
- Reduce default per-page retry cost by lowering the HTTP retry default from 6 to 3.
- Add a target-level abort policy that stops a crawl when child-page failures exceed a configured failure rate.
- Keep the configuration surface minimal by exposing a single user-facing threshold.
- Exclude expected refresh deletion handling from the threshold so refresh cleanup remains safe.
- Preserve existing semantics that a root page failure aborts the job immediately.

**Non-Goals:**
- Add both rate and count thresholds as separate public settings.
- Introduce a time-windowed circuit breaker, cooldowns, or half-open recovery logic.
- Change which HTTP status codes are treated as retryable.
- Rework `ignoreErrors` into a broader policy system.

## Decisions

### Use a failure-rate threshold instead of a count threshold

The scraper will expose a single configuration key, `scraper.abortOnFailureRate`, representing the maximum tolerated child-page failure rate before aborting the crawl. The value will be a fraction in the inclusive range `[0.0, 1.0]`, and the initial default will be `0.5`.

Rationale:
- A rate scales better across small and large crawls than a fixed count.
- One threshold keeps the configuration surface small.
- The failure-rate model aligns with the user's fail-fast goal without requiring per-target tuning for crawl size.

Alternatives considered:
- Count-only threshold: simpler on paper, but it behaves inconsistently across crawl sizes.
- Exposing both rate and count: more flexible, but adds configuration complexity the user explicitly wants to avoid.

### Use an internal minimum sample size before evaluating the threshold

The scraper will only evaluate the failure-rate threshold after an internal minimum number of completed child-page attempts have been observed. The initial design uses a constant of 10 completed child-page attempts, counted as successful child-page completions plus terminal child-page failures, excluding refresh deletions and in-flight attempts.

Rationale:
- Prevents early aborts from one or two isolated failures near the start of a crawl.
- Keeps the public API simple while still making rate-based aborts practical.

Alternatives considered:
- No minimum sample: too sensitive for small crawls.
- Configurable minimum sample: useful but adds another knob for marginal benefit.

### Count only terminal child-page processing failures toward the threshold

The strategy layer will increment failure counters only when a child page fails after retry policy has already been exhausted and the page processing path throws. Root-page failures remain immediate hard failures and do not flow through threshold logic.

Rationale:
- Keeps responsibility boundaries clear: fetcher handles per-request retries, strategy handles crawl policy.
- Measures true page-level failures rather than transient sub-attempts.

Alternatives considered:
- Counting every retry attempt: too noisy and would over-penalize transient outages.
- Counting pipeline warnings or empty content as failures: would blur the difference between degraded content and hard failure.

### Exclude refresh deletions from failure accounting

Pages that resolve to `FetchStatus.NOT_FOUND` during refresh mode will continue to be treated as expected deletions and will not count toward the failure-rate threshold.

Rationale:
- Refresh cleanup is expected maintenance behavior, not a target health failure.
- Prevents valid refresh jobs from aborting when many stale pages have been removed upstream.

### Apply the threshold even when `ignoreErrors` is true

`ignoreErrors` will continue to suppress isolated child-page failures, but once the configured failure-rate threshold is exceeded after the minimum sample size, the crawl will abort.

Rationale:
- Preserves resilience for a few bad pages.
- Prevents `ignoreErrors` from masking a target that is broadly broken.

## Risks / Trade-offs

- [Small crawls may still complete despite high failure ratios] -> The minimum sample size intentionally favors tolerance for tiny crawls to avoid noisy aborts.
- [Some borderline unhealthy sites may abort sooner than today] -> This is expected and aligned with fail-fast behavior; documentation and tests should make the policy explicit.
- [A single threshold may not fit every deployment] -> Start with one config key and a documented default; add more tuning only if real usage shows a clear need.
- [Behavior changes for existing scrape jobs] -> Keep root failure semantics unchanged and limit the change to child-page threshold behavior plus reduced retries.

## Migration Plan

1. Update scraper config defaults and schema to lower `scraper.fetcher.maxRetries` to `3` and add `scraper.abortOnFailureRate`.
2. Implement child-page attempt and failure accounting in `BaseScraperStrategy`.
3. Abort the crawl when the failure rate exceeds the configured threshold after the internal minimum sample size.
4. Add or update tests for fetcher retry defaults, threshold-triggered aborts, root-page failures, and refresh deletions.
5. Document the new default behavior through specs and config-facing tests.

Rollback strategy:
- Restore the previous retry default and remove the threshold checks if production behavior proves too aggressive.

## Open Questions

- None.
