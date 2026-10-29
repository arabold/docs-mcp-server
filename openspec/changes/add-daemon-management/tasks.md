# Tasks: Add Daemon Management

## 1. Dependencies & Setup

- [ ] 1.1 Add `node-mac`, `node-windows`, `node-linux` as dependencies in `package.json`
- [ ] 1.2 Add TypeScript type declarations (or create local types if not available)
- [ ] 1.3 Verify packages install correctly on all platforms (may need to test in CI)

## 2. Core Daemon Service Module

- [ ] 2.1 Create `src/daemon/types.ts` with interfaces:
  - `DaemonOptions` (name, scriptPath, env vars, port, host, etc.)
  - `DaemonStatus` (installed, running, pid, etc.)
  - `DaemonConfig` (restart behavior, logging)
- [ ] 2.2 Create `src/daemon/DaemonService.ts`:
  - Platform detection logic (`process.platform`)
  - Dynamic import of platform-specific package
  - `install(options)` method
  - `uninstall()` method
  - `start()` method
  - `stop()` method
  - `restart()` method
  - `status()` method returning `DaemonStatus`
- [ ] 2.3 Create `src/daemon/index.ts` barrel export
- [ ] 2.4 Write unit tests `src/daemon/DaemonService.test.ts`:
  - Mock platform packages
  - Test install flow
  - Test uninstall flow
  - Test status detection

## 3. CLI Command Implementation

- [ ] 3.1 Create `src/cli/commands/daemon.ts`:
  - Parent command `daemon` with subcommands
  - `daemon install` with options (--port, --host, --resume, --read-only, --store-path)
  - `daemon uninstall` with confirmation prompt
  - `daemon status` showing current state
  - `daemon start` to start installed service
  - `daemon stop` to stop running service
  - `daemon restart` to restart service
- [ ] 3.2 Add telemetry tracking for daemon commands
- [ ] 3.3 Register `createDaemonCommand` in `src/cli/index.ts`
- [ ] 3.4 Add user-friendly error messages for:
  - Missing elevated privileges
  - Service not installed (for start/stop/status)
  - Service already installed
  - WSL detection with guidance

## 4. Configuration & Environment

- [ ] 4.1 Implement environment variable mapping for daemon:
  - `DOCS_MCP_PORT` from --port
  - `DOCS_MCP_HOST` from --host
  - `DOCS_MCP_STORE_PATH` from --store-path
  - `DOCS_MCP_RESUME` from --resume
  - `DOCS_MCP_READ_ONLY` from --read-only
- [ ] 4.2 Ensure `loadConfig` in server startup respects these env vars
- [ ] 4.3 Determine and document script path for installed daemon:
  - Global npm install: use `which docs-mcp-server` or npm prefix
  - Local/dev: use resolved path to `dist/index.js`

## 5. Testing

- [ ] 5.1 Add integration tests for daemon command parsing
- [ ] 5.2 Manual E2E testing on macOS (launchd)
- [ ] 5.3 Manual E2E testing on Windows (Windows Service)
- [ ] 5.4 Manual E2E testing on Linux (systemd/init.d)
- [ ] 5.5 Test permission error handling (run without sudo)

## 6. Documentation

- [ ] 6.1 Update `README.md` with daemon installation section:
  - Platform-specific prerequisites
  - Installation commands
  - Uninstallation commands
  - Log file locations
  - Troubleshooting common issues
- [ ] 6.2 Add `--help` text for all daemon subcommands
- [ ] 6.3 Document permission requirements clearly

## 7. Finalization

- [ ] 7.1 Run linter and fix any issues
- [ ] 7.2 Run typecheck and fix any issues
- [ ] 7.3 Run full test suite
- [ ] 7.4 Update CHANGELOG if applicable
