# Custom Instructions

- The repository for this project is located on GitHub at `arabold/docs-mcp-server`.
- You must read the `README.md` to understand the project structure and setup.
- You must read the `ARCHITECTURE.md` file before making changes across multiple services.
- You must follow DRY, KISS, YAGNI, and SOLID principles.
- You must use the latest version of the programming language and libraries.
- Prefer the simplest solution.
- Never commit secrets, credentials, or sensitive data to the repository.

## Documentation

- The `README.md` targets end users that utilize the library for the first time. It should primarily cover prerequisites, installation, configuration, first start, trouble shooting.
- The `ARCHITECTURE.md` targets developers making active changes to the code. It should give a high level overview of the architecture of the library, a feature list, and then reference individual feature documentations in the docs/ folder.
- Write in present tense, describing how the system currently works
- Focus on what the system does, not what it doesn't do or used to do
- Avoid discussing past problems, bugs, or alternative approaches unless directly relevant to understanding the current design
- Use declarative statements rather than explanatory narratives
- Don't include "Important" callouts or emphasis unless documenting critical constraints
- Avoid problem/solution framing - just describe the current behavior and its rationale
- Keep examples focused on illustrating current functionality, not contrasting with previous versions
- Do not create new documentation files unless explicitly asked to. Instead update existing files or create new sections as needed.

### Source Code Documentation

- Ensure each source file begins with a comment block summarizing its purpose and logic.
- If no block exists, create one before editing.
- After completing changes, update this block to reflect the changes.
- Always make the comment block clear and concise.

## Architecture

- Focus on system concepts and component relationships.
- Put implementation details in source code.
- Update `ARCHITECTURE.md` when the architecture changes.
- Do not use special characters like braces in mermaid diagram titles or names. Quote them if necessary.
- Do not use markdown in mermaid diagrams.

## TypeScript

- Install dependencies using `npm install` inside `apps/<service_name>` instead of adding them to the `package.json` file manually.
- We're using Node.js 22.x, `vite-node` for running TypeScript files, and `vitest` for testing.
- Prefer a specific type or `unknown` over `any`.
- Do not use non-null assertions (`!`). Use optional chaining (`?.`) or nullish coalescing (`??`).
- Follow `biome` for formatting and import order.
- Always place `import` statements at the top of the file.

## Web UI

- Use AlpineJS for frontend components and TailwindCSS for styling.
- Use TSX with kitajs for AlpineJS components.
- Use HTMX for server-side interactions.
- Avoid `{foo && <Bar />}` in TSX; use ternary expressions instead.

## Logging

- Use `console.*` for CLI user output (results, direct feedback).
- Use `logger.info/warn/error` for meaningful application events; prefix with a relevant emoji.
- Use `logger.debug` for detailed developer/tracing logs; no emoji prefix.
- Prefer `logger.debug` over `logger.info` for granular internal steps to reduce log verbosity.

## Testing

- Consider maintainability and efforts when writing tests.
- Always create unit test files alongside the source file with `.test.ts` suffix.
- Focus on high value, low effort tests first. Defer complex mocking, complex state management testing and concurrent processing unless explicitly requested by the user.
- Always test the intended bevavior, not the implementation details.
- Avoid timing sensitive tests unless absolutely necessary.
- Use `npx vite-node` to run individual TypeScript files.

## Git

- Branches must be created locally before pushing.
- Branch names must be prefixed with type (`feature/`, `bugfix/`, `chore/`) and include the issue number if available (e.g., `feature/1234-description`).
- All commit messages must use Conventional Commits (`feat:`, `fix:`, etc.).
- Commit subject must be imperative mood and ≤72 characters.
- If a commit body is present, add a blank line before it.
- Commit body (for non-trivial changes) must explain what and why, not how.
- Reference related issues in commit messages when relevant (e.g., `Closes #123`).
- Do not include unrelated changes in a single commit.
- Do not use vague or generic commit messages.
- Pull request descriptions must summarize the what and why of all changes in the branch (not just a list of commits or the how).
- Pull requests must target `main` unless specified otherwise.
- When creating new GitHub issues, use built-in labels to categorize them (e.g., `bug`, `enhancement`, `documentation`) but avoid creating new labels unless explicitly asked to.
