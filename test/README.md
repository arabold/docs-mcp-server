# End-to-End Tests

This directory contains end-to-end tests for the HTML pipeline functionality. These tests validate real-world website scraping and content extraction capabilities.

## Test Structure

### `html-pipeline-basic-e2e.test.ts`

Fast, reliable tests using httpbin.org endpoints. These tests:

- Validate core HTML pipeline functionality
- Test error handling, redirects, and different content types
- Are suitable for CI/CD environments (fast, stable)
- Don't depend on external websites that might change

### `html-pipeline-websites-e2e.test.ts`

Comprehensive real-world website tests. These tests:

- Validate extraction from actual documentation sites
- Test different website structures and CMSs
- Verify content quality and cleanup
- Test different scrape modes (Playwright vs Fetch)
- Require internet access and may be slower

## Overview

The e2e tests are separate from unit tests and are designed to:

- Test real website scraping with the actual `FetchUrlTool` and `HtmlPipeline`
- Validate content extraction across different website structures and CMSs
- Ensure the pipeline can handle various HTML patterns and JavaScript-rendered content
- Test different scrape modes (Playwright, Fetch, Auto)
- Validate error handling for network failures and invalid URLs

## Running Tests

### Run all e2e tests

```bash
npm run test:e2e
```

### Run only basic tests (fast, good for CI)

```bash
npm run test:e2e -- test/html-pipeline-basic-e2e.test.ts
```

### Run only website tests

```bash
npm run test:e2e -- test/html-pipeline-websites-e2e.test.ts
```

### Run e2e tests in watch mode

```bash
npm run test:e2e:watch
```

### Run specific website tests

```bash
# Run only Salesforce documentation tests
npm run test:e2e -- test/html-pipeline-websites-e2e.test.ts -t "Salesforce"

# Run only content quality tests
npm run test:e2e -- test/html-pipeline-websites-e2e.test.ts -t "Content Quality"
```

## Test Categories

### Website-Specific Tests

- **Salesforce Documentation**: Tests complex enterprise documentation sites
- **GitHub Documentation**: Tests developer documentation with code examples
- **MDN Web Docs**: Tests technical reference documentation
- **npm Package Documentation**: Tests package registry pages
- **Stack Overflow**: Tests Q&A content extraction
- **AWS Documentation**: Tests cloud provider documentation
- **React Documentation**: Tests modern framework documentation
- **Python Documentation**: Tests Python ecosystem documentation
- **TypeScript Documentation**: Tests programming language documentation

### Quality Assurance Tests

- **Content Quality**: Validates that navigation elements are removed and main content is preserved
- **Structured Content**: Ensures code blocks, headers, and formatting are maintained
- **Different Scrape Modes**: Tests Playwright vs Fetch mode differences
- **Error Handling**: Validates graceful failure for invalid URLs and HTTP errors

## Test Configuration

- **Timeout**: 60-120 seconds per test (network operations take time)
- **Retry**: 1 retry for flaky network tests
- **Sequential Execution**: Tests run one at a time to avoid overwhelming target websites
- **Network Dependencies**: Tests require internet access and may fail if target sites are down

## Adding New Tests

When adding new website tests:

1. Choose a stable, well-known website URL that's unlikely to change
2. Use specific content validation that proves the extraction worked correctly
3. Set appropriate timeouts (60s for most sites, 120s for slow sites)
4. Include both positive (content present) and negative (unwanted content removed) assertions
5. Consider testing different content types (text, code, tables, lists)

Example test structure:

```typescript
it("should extract content from Example Site", async () => {
  const url = "https://example.com/docs/page";

  const result = await fetchUrlTool.execute({
    url,
    scrapeMode: ScrapeMode.Auto,
    followRedirects: true,
  });

  expect(result).toBeTruthy();
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(100);

  // Verify specific content was extracted
  expect(result.toLowerCase()).toContain("expected content");

  // Verify unwanted content was removed
  expect(result.toLowerCase()).not.toContain("navigation menu");
}, 60000);
```

## Troubleshooting

### Common Issues

1. **Network timeouts**: Some sites may be slow or temporarily unavailable
2. **Rate limiting**: Running tests too frequently may trigger rate limits
3. **Content changes**: Target websites may update their content, breaking assertions
4. **Playwright dependencies**: Ensure Playwright browsers are installed for full testing

### Debugging Failed Tests

1. Check if the target website is accessible in a browser
2. Run the specific failing test in isolation
3. Examine the extracted content by adding `console.log(result)` temporarily
4. Try different scrape modes if one fails
5. Check for recent changes to the target website structure
