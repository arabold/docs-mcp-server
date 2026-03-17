# Design: Parallel Scrape Job State Isolation

## Context

The scraping system uses a registry pattern where `ScraperRegistry` creates strategy instances once in its constructor and reuses them for all scrape operations. Each strategy (e.g., `WebScraperStrategy`) maintains instance-level state:

```typescript
// BaseScraperStrategy.ts
protected visited = new Set<string>();  // URLs already processed
protected pageCount = 0;                // Current page counter
protected totalDiscovered = 0;          // Total URLs found
protected effectiveTotal = 0;           // URLs limited by maxPages
```

When `scrape()` is called, it resets these counters. However, if two jobs run in parallel using the same strategy instance, they interfere with each other's state.

## Goals / Non-Goals

**Goals:**
- Ensure each scrape job has completely isolated state
- Clean up strategy resources (browser instances, temp files) after each scrape
- Maintain the existing static `HtmlPlaywrightMiddleware.resourceCache` for cross-scrape caching benefits

**Non-Goals:**
- Changing the strategy interface or internal state management
- Adding concurrency locks (would serialize jobs unnecessarily)
- Preserving backward compatibility for `cleanup()` methods (internal APIs only)

## Decisions

### Decision 1: Factory Pattern for ScraperRegistry

Convert `ScraperRegistry` from caching strategy instances to creating fresh instances on each `getStrategy()` call.

**Before:**
```typescript
constructor(config: AppConfig) {
  this.strategies = [
    new WebScraperStrategy(config, {}),
    // ... cached instances
  ];
}

getStrategy(url: string): ScraperStrategy {
  return this.strategies.find(s => s.canHandle(url));
}
```

**After:**
```typescript
private config: AppConfig;

constructor(config: AppConfig) {
  this.config = config;
}

getStrategy(url: string): ScraperStrategy {
  // Create fresh instance each time
  if (url matches npm pattern) return new NpmScraperStrategy(this.config);
  // ...
}
```

**Rationale:** This is the cleanest fix with minimal code changes. Each scrape gets isolated state without modifying strategy classes.

**Alternatives Considered:**
1. *Move state to per-scrape context* - Would require refactoring all strategies and passing context through method chains. More invasive.
2. *Add concurrency locks* - Would serialize parallel jobs, defeating the purpose of concurrency.
3. *Clone strategies* - Strategies contain complex objects (browser instances) that can't be easily cloned.

### Decision 2: Per-Scrape Cleanup in ScraperService

Move cleanup responsibility from "manager shutdown" to "after each scrape completes."

```typescript
async scrape(...): Promise<void> {
  const strategy = this.registry.getStrategy(options.url);
  try {
    await strategy.scrape(options, progressCallback, signal);
  } finally {
    await strategy.cleanup?.();  // Always cleanup, even on error
  }
}
```

**Rationale:** With factory pattern, each strategy instance is used exactly once. Cleaning up immediately after use prevents resource leaks and ensures browsers/temp files are released promptly.

### Decision 3: Remove Registry and Service Cleanup Methods

Remove `ScraperRegistry.cleanup()` and `ScraperService.cleanup()` entirely.

**Rationale:** 
- With factory pattern, no strategies are cached in the registry
- Cleanup now happens per-scrape in `ScraperService.scrape()`
- Keeping empty methods for "backward compatibility" adds confusion
- All code is internal (not a public API)

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Browser instance per job | Each job properly cleans up via `strategy.cleanup()` in finally block |
| More object allocations | Negligible compared to actual scraping work |
| Static cache still shared | This is intentional - LRU cache for resources benefits all jobs |

## Migration Plan

1. Update `ScraperRegistry` to factory pattern
2. Add try/finally cleanup in `ScraperService.scrape()`
3. Remove `ScraperRegistry.cleanup()` and `ScraperService.cleanup()` methods
4. Update `PipelineManager.stop()` to remove cleanup call
5. Update all affected tests
6. Add new test for parallel isolation

**Rollback:** Revert the PR. No data migration needed.

## Open Questions

None - all questions resolved during analysis.
