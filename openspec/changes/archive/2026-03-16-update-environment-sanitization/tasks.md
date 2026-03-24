# Tasks: Update Environment Variable Sanitization

## 1. Bootstrap Sanitization

- [x] 1.1 Add a shared environment sanitization utility that trims whitespace and strips matching surrounding single or double quotes
- [x] 1.2 Update the application bootstrap path to run environment sanitization after `.env` loading and before runtime modules consume `process.env`
- [x] 1.3 Remove redundant one-off environment quote handling that becomes unnecessary after bootstrap sanitization

## 2. Configuration Safeguards

- [x] 2.1 Keep `DOCS_MCP_*` environment normalization in `src/utils/config.ts`
- [x] 2.2 Verify config precedence and fallback behavior remain unchanged after bootstrap sanitization

## 3. Test Coverage

- [x] 3.1 Add unit tests for the shared environment sanitization utility
- [x] 3.2 Add bootstrap-oriented tests covering quoted provider URLs, credentials, tokens, and runtime flags
- [x] 3.3 Update existing GH-353 regression tests to validate the generic path rather than only one direct call site

## 4. Verification

- [x] 4.1 Run `npm run lint`
- [x] 4.2 Run `npm run typecheck`
- [x] 4.3 Run `npm test`
