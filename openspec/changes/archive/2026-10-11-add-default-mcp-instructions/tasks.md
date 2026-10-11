## 1. Default Text

- [x] 1.1 Add `src/mcp/defaultInstructions.ts` with `buildDefaultInstructions(readOnly)` returning the draft texts from design.md, and verify with a unit test that the normal text names `scrape_docs` and `get_job_info` and the read-only text names neither and says the server cannot index new documentation
- [x] 1.2 Add a test in `src/mcp/mcpServer.test.ts` that connects a client in each mode and checks that every backtick-quoted tool name in that mode's default text appears in `tools/list`, and verify it fails when a name in the text is changed to an unregistered one

## 2. Resolution

- [x] 2.1 Make `resolveServerInstructions()` return `buildDefaultInstructions(config.app.readOnly)` when neither setting is configured, and update its TSDoc; verify by replacing the "returns undefined when no instructions are configured" test with one that expects the default for each mode
- [x] 2.2 Add a test that configured inline text and configured file contents are returned unchanged, without any of the default text, and verify it passes
- [x] 2.3 Make the `instructions` parameter of `createMcpServerInstance()` required, update all call sites in `src/mcp/mcpServer.test.ts`, and verify with `rm -f .tsbuildinfo && npm run typecheck`
- [x] 2.4 Add a test in `src/utils/config.test.ts` that loading the configuration with nothing configured leaves `server.instructions` unset and the auto-saved `config.yaml` contains no `instructions` key, and verify it passes

## 3. End-to-End

- [x] 3.1 Extend `test/mcp-stdio-e2e.test.ts` so a client connected with no instructions configured receives the default text, and verify with `npx vitest run test/mcp-stdio-e2e.test.ts`

## 4. Documentation

- [x] 4.1 Update the `instructions` row in `docs/setup/configuration.md` to say that built-in instructions are sent when neither setting is configured and that configured text replaces them, and verify the table still renders
- [x] 4.2 Add a sentence on server instructions to the "MCP Protocol Integration" section of `ARCHITECTURE.md` and verify it describes the built-in default and the replacement rule

## 5. Validation

- [x] 5.1 Run `npm run lint`, `rm -f .tsbuildinfo && npm run typecheck`, and `npm test`, and verify all pass
- [x] 5.2 Run a promptfoo evaluation (`gpt-5.4-mini`, with and without the built-in text as the system prompt) and confirm the model searches first, passes a pinned version, and reads the documentation of an unindexed library instead of answering from memory; record the result in design.md
- [x] 5.3 Run `openspec validate add-default-mcp-instructions --strict` and verify it passes
