# Agent Instructions for docs-mcp-server

## Repository Context

- Repository: `arabold/docs-mcp-server`
- Read `README.md` for project structure and setup
- Read `ARCHITECTURE.md` before making changes across multiple services
- Follow DRY, KISS, YAGNI, and SOLID principles
- Use latest stable versions of programming language and libraries
- Prefer the simplest solution that meets requirements
- Never commit secrets, credentials, or sensitive data

## Documentation

### File Targets

- `README.md` targets end users: prerequisites, installation, configuration, first start, troubleshooting
- `ARCHITECTURE.md` targets active developers: high-level architecture, feature list, references to `docs/` folder
- `docs/` folder provides deep dives into specific features, subsystems, or technical concepts

### Writing Principles

- Use present tense to describe current system behavior
- Use declarative statements, not explanatory narratives
- Describe what the system does, not what it doesn't do or used to do
- Avoid problem/solution framing - describe current behavior and rationale
- Omit "Important" callouts unless documenting critical constraints or safety issues
- Keep examples focused on current functionality, not historical comparisons
- Update existing documentation or add sections; only create new files when explicitly requested

### Structure Guidelines

- Start with high-level overview before details
- Use clear, descriptive section headers
- Progress from concepts to specifics (allows readers to stop when satisfied)
- Use tables for comparing options, statuses, or behaviors
- Include Mermaid diagrams for workflows, state machines, or component relationships
- Focus on high-level concepts and component relationships (use class/interface names when helpful, as they change less frequently than implementation details)
- Explain architectural decisions with trade-offs
- Avoid explaining source code implementation - use TSDoc comments in source files instead

### Source Code Documentation

- Document source code with TSDoc comments (not in separate documentation files)
- Each source file must begin with a comment block summarizing purpose and logic
- Create the comment block before editing if it doesn't exist
- Update the comment block after completing changes
- Keep comment blocks clear and concise

## Architecture Documentation

- Focus on system concepts and component relationships
- Place implementation details in source code, not architecture docs
- Update `ARCHITECTURE.md` when architecture changes
- In Mermaid diagrams:
  - Avoid special characters (e.g., braces) in titles or names; quote if necessary
  - Do not use markdown formatting

## TypeScript Conventions

### Dependencies and Tooling

- Install dependencies via `npm install` (not by manually editing `package.json`)
- Runtime: Node.js 22.x
- Execution: `vite-node` for running TypeScript files
- Testing: `vitest`

### Type Safety

- Prefer specific types or `unknown` over `any`
- Avoid non-null assertions (`!`)
- Use optional chaining (`?.`) and nullish coalescing (`??`)

### Code Style

- Follow `biome` for formatting and import order
- Place all `import` statements at the top of files

## Web UI Stack

- Frontend components: AlpineJS
- Styling: TailwindCSS
- AlpineJS components: TSX with kitajs
- Server-side interactions: HTMX
- TSX pattern: Use ternary expressions (`{foo ? <Bar /> : null}`), not short-circuit evaluation (`{foo && <Bar />}`)

## Logging Strategy

### Output Channels

- `console.*`: CLI user output (results, direct feedback to user)
- `logger.info/warn/error`: Meaningful application events (prefix with relevant emoji)
- `logger.debug`: Detailed developer/tracing logs (no emoji prefix)

### Verbosity Control

- Prefer `logger.debug` over `logger.info` for granular internal steps
- Reduces default log verbosity while maintaining debugging capability

## Testing Approach

### Test Files

- Create unit test files alongside source files with `.test.ts` suffix
- Run individual TypeScript files: `npx vite-node <file>`

### Test Strategy

- Prioritize high-value, low-effort tests
- Test intended behavior, not implementation details
- Defer complex mocking, state management testing, and concurrent processing unless explicitly requested
- Avoid timing-sensitive tests unless absolutely necessary
- Balance maintainability with test coverage

## Git Workflow

### Branching

- Create branches locally before pushing
- Branch naming: `<type>/<issue-number>-<description>` (e.g., `feature/1234-add-refresh-logic`)
- Types: `feature/`, `bugfix/`, `chore/`

### Commits

- Format: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`)
- Subject: Imperative mood, ≤72 characters
- Body: Separate from subject with blank line
- Body content: Explain what and why, not how (for non-trivial changes)
- Reference issues when relevant (e.g., `Closes #123`)
- One logical change per commit (no unrelated changes)
- Avoid vague messages (e.g., "fix bug", "update code")

### Pull Requests

- Description: Summarize what and why of all changes (not just commit list or how)
- Target: `main` branch unless specified otherwise

### Issues

- Use built-in labels to categorize (e.g., `bug`, `enhancement`, `documentation`)
- Avoid creating new labels unless explicitly requested
