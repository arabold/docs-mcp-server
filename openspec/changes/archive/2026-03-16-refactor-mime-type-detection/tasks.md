## 1. Update MimeTypeUtils Mappings

- [x] 1.1 Add documentation format extensions to `customMimeTypes` (rst, adoc, asciidoc, textile, org, etc.)
- [x] 1.2 Add additional programming language extensions to `customMimeTypes` (lua, r, julia, haskell, etc.)
- [x] 1.3 Add modern framework extensions to `customMimeTypes` (vue, svelte, astro, etc.)
- [x] 1.4 Add configuration file extensions to `customMimeTypes` (toml, ini, env, hcl, etc.)
- [x] 1.5 Add build/infrastructure extensions to `customMimeTypes` (makefile, cmake, tf, etc.)
- [x] 1.6 Add schema/API definition extensions to `customMimeTypes` (prisma, thrift, avro, etc.)
- [x] 1.7 Add corresponding entries to `mimeToLanguage` for syntax highlighting
- [x] 1.8 Add entries to `mimeTypeNormalization` for incorrect mime package results (video/mp2t, application/vnd.lotus-organizer, etc.)

## 2. Consolidate MIME Type Detection

- [x] 2.1 Update `LocalFileStrategy.ts` to use `MimeTypeUtils.detectMimeTypeFromPath()` instead of `mime.getType()`
- [x] 2.2 Remove direct `mime` import from `LocalFileStrategy.ts`
- [x] 2.3 Update `GitHubScraperStrategy.ts` to use `MimeTypeUtils.detectMimeTypeFromPath()` instead of `mime.getType()`
- [x] 2.4 Remove direct `mime` import from `GitHubScraperStrategy.ts`

## 3. Testing and Validation

- [x] 3.1 Add/update unit tests for new MIME type mappings in `mimeTypeUtils.test.ts`
- [x] 3.2 Add test case specifically for RST files
- [x] 3.3 Run full test suite (`npm test`) - 1377 tests passed
- [x] 3.4 Run typecheck and lint (`npm run typecheck && npm run lint`) - All passed
