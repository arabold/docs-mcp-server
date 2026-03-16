## 1. Fix ArchiveFactory
- [x] 1.1 Remove magic byte fallback (lines 26-59) from `getArchiveAdapter()` in `src/utils/archive/ArchiveFactory.ts`
- [x] 1.2 Remove unused `fs` import and `logger` import (only used by magic byte block)

## 2. Tests
- [x] 2.1 Add unit tests for `ArchiveFactory.getArchiveAdapter()` verifying `.zip` returns `ZipAdapter`, `.tar`/`.gz`/`.tgz` return `TarAdapter`
- [x] 2.2 Add unit tests verifying `.docx`, `.xlsx`, `.pptx`, `.epub`, `.odt`, `.ods`, `.odp` return `null`
- [x] 2.3 Add unit test verifying extensionless files return `null`

## 3. Validation
- [x] 3.1 Run existing archive tests (`npx vitest run src/utils/archive` and `npx vitest run test/archive-integration`)
- [x] 3.2 Run full test suite (`npm test`)
- [x] 3.3 Run lint and typecheck (`npm run lint && npm run typecheck`)
