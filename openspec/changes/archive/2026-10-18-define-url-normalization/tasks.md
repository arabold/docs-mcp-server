## 1. Remove case folding

- [x] 1.1 Drop `ignoreCase` from `UrlNormalizerOptions` and from the defaults.
- [x] 1.2 Remove the lowercasing step from `normalizeUrl`.
- [x] 1.3 Drop the redundant explicit flag from `NpmScraperStrategy` and `PyPiScraperStrategy`.
- [x] 1.4 Drop the now-unnecessary override in `canonicalizeStoredUrl`, keeping its `preserveHashes` exemption.

## 2. Tests

- [x] 2.1 Replace the opt-out test with one asserting case is preserved unconditionally.
- [x] 2.2 Cover the rule the removal exists for: two URLs differing only by path case normalize differently, so both are crawled rather than one being dropped.
- [x] 2.3 Confirm the remaining transformations are unchanged — trailing slash, site root, directory index, fragment, query.

## 3. Validation

- [x] 3.1 Run `npm run lint` and `npm run typecheck`.
- [x] 3.2 Run the full test suite; expect scope and dedup tests to be unaffected, since none of them relies on case folding.
