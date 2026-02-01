## 1. Update MimeTypeUtils Mappings

- [ ] 1.1 Add documentation format extensions to `customMimeTypes` (rst, adoc, asciidoc, textile, org, etc.)
- [ ] 1.2 Add additional programming language extensions to `customMimeTypes` (lua, r, julia, haskell, etc.)
- [ ] 1.3 Add modern framework extensions to `customMimeTypes` (vue, svelte, astro, etc.)
- [ ] 1.4 Add configuration file extensions to `customMimeTypes` (toml, ini, env, hcl, etc.)
- [ ] 1.5 Add build/infrastructure extensions to `customMimeTypes` (makefile, cmake, tf, etc.)
- [ ] 1.6 Add schema/API definition extensions to `customMimeTypes` (prisma, thrift, avro, etc.)
- [ ] 1.7 Add corresponding entries to `mimeToLanguage` for syntax highlighting
- [ ] 1.8 Add entries to `mimeTypeNormalization` for incorrect mime package results (video/mp2t, application/vnd.lotus-organizer, etc.)

## 2. Consolidate MIME Type Detection

- [ ] 2.1 Update `LocalFileStrategy.ts` to use `MimeTypeUtils.detectMimeTypeFromPath()` instead of `mime.getType()`
- [ ] 2.2 Remove direct `mime` import from `LocalFileStrategy.ts`
- [ ] 2.3 Update `GitHubScraperStrategy.ts` to use `MimeTypeUtils.detectMimeTypeFromPath()` instead of `mime.getType()`
- [ ] 2.4 Remove direct `mime` import from `GitHubScraperStrategy.ts`

## 3. Testing and Validation

- [ ] 3.1 Add/update unit tests for new MIME type mappings in `mimeTypeUtils.test.ts`
- [ ] 3.2 Add test case specifically for RST files
- [ ] 3.3 Run full test suite (`npm test`)
- [ ] 3.4 Run typecheck and lint (`npm run typecheck && npm run lint`)
