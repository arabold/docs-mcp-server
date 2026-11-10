# Design: Daemon Management

## Context

The docs-mcp-server needs to run as a persistent background process to provide continuous MCP service to AI clients. Currently, users must manually start the server in a terminal, which is inconvenient for daily use and doesn't survive system reboots.

**Stakeholders**: End users running docs-mcp-server locally or on servers.

**Constraints**:
- Must support macOS, Windows, and Linux
- Must not require native module compilation (pure JavaScript)
- Must work with the existing CLI framework (Yargs)
- Service management requires elevated privileges

## Goals / Non-Goals

### Goals
- Provide simple CLI commands to install/uninstall the server as a system daemon
- Support all three major platforms with native service mechanisms
- Allow configuration of server options (port, host) at install time
- Provide status, start, stop, restart commands for lifecycle management
- Handle permission requirements gracefully with clear error messages

### Non-Goals
- Container/Docker orchestration (separate concern)
- Cluster/multi-instance management
- GUI installer
- Auto-update mechanism

## Decisions

### Decision 1: Use node-windows/node-mac/node-linux Package Family

**What**: Use the established `node-windows`, `node-mac`, and `node-linux` packages by Corey Butler for cross-platform daemon management.

**Why**:
- Mature, battle-tested packages (2.9k+ stars for node-windows)
- Pure JavaScript (no native compilation required)
- Consistent API across all three packages
- MIT licensed
- Handles platform-specific details (launchd, Windows Services, systemd/init.d)
- Built-in service monitoring with configurable restart behavior

**Alternatives considered**:
1. **Manual platform scripts**: Would require maintaining separate bash/powershell/plist scripts. High maintenance burden.
2. **PM2**: Designed for Node.js process management but not native OS services. Adds complexity and another background process.
3. **systemd-only on Linux**: Would limit Linux support to systemd-based distros.

### Decision 2: Subcommand Pattern (`daemon <action>`)

**What**: Group all daemon operations under a `daemon` parent command.

**Why**:
- Aligns with existing CLI patterns (though current commands are flat, `daemon` is a logical grouping)
- Avoids namespace conflicts (`install`, `start`, `stop`, `status` are generic terms)
- Enables discoverability (`docs-mcp-server daemon --help`)
- Follows precedent from Docker, systemctl, npm, etc.

**Command structure**:
```
daemon install [--port] [--host] [--resume] [--read-only] [--store-path]
daemon uninstall
daemon status
daemon start
daemon stop
daemon restart
```

### Decision 3: Configuration Persistence via Environment Variables

**What**: Pass server configuration to the daemon via environment variables set in the service definition.

**Why**:
- The node-* packages natively support environment variable configuration
- Avoids needing a separate config file for daemon-specific settings
- Consistent with 12-factor app principles
- Configuration travels with the service definition

**Implementation**:
```javascript
const svc = new Service({
  name: 'docs-mcp-server',
  script: '/path/to/dist/index.js',
  env: [
    { name: 'DOCS_MCP_PORT', value: '3000' },
    { name: 'DOCS_MCP_HOST', value: '0.0.0.0' },
    { name: 'DOCS_MCP_STORE_PATH', value: '/path/to/store' },
  ]
});
```

### Decision 4: Platform-Agnostic DaemonService Abstraction

**What**: Create a `DaemonService` class that provides a unified API across all platforms.

**Why**:
- Encapsulates platform detection and package selection
- Single interface for CLI commands to use
- Easier testing via dependency injection
- Future-proofs against package API changes

**Structure**:
```
src/daemon/
├── DaemonService.ts       # Main abstraction class
├── types.ts               # DaemonOptions, DaemonStatus interfaces
└── DaemonService.test.ts  # Unit tests
```

### Decision 5: Service Name

**What**: Use `docs-mcp-server` as the fixed service name.

**Why**:
- Matches the npm package name for consistency
- Unique enough to avoid conflicts
- Clear identification in system tools (Activity Monitor, Services, systemctl)

## Risks / Trade-offs

### Risk 1: Elevated Privileges Required
- **Risk**: Install/uninstall operations require sudo/admin, which may fail or confuse users.
- **Mitigation**: Clear error messages explaining the permission requirement. Documentation with example commands.

### Risk 2: Windows WSL Confusion
- **Risk**: Users in WSL might try to install a Windows service, which won't work.
- **Mitigation**: Detect WSL environment and provide appropriate guidance to use Linux service or native Windows outside WSL.

### Risk 3: Package Maintenance
- **Risk**: The node-* packages may become unmaintained.
- **Mitigation**: The packages are stable (minimal updates needed for mature OS APIs). Fork if necessary. The abstraction layer isolates the CLI from direct package dependencies.

### Risk 4: Service Recovery Loops
- **Risk**: If the server has a fatal bug, the service might restart endlessly.
- **Mitigation**: Use the built-in `maxRestarts` and `maxRetries` configuration to cap restart attempts. Default to sensible limits (e.g., 5 restarts in 60 seconds).

## Migration Plan

This is a new feature with no migration required. Users can adopt it optionally.

**Rollout**:
1. Implement and test on all three platforms
2. Document in README with platform-specific notes
3. Add to CLI help text

**Rollback**: Simply don't use the daemon commands; manual startup continues to work.

## Open Questions

1. **Log file location**: Should we configure a specific log location for daemon output, or use the platform defaults?
   - **Proposed answer**: Use platform defaults initially (`/Library/Logs/` on macOS, Event Log on Windows, `/var/log/` on Linux). Document locations.

2. **Multiple instances**: Should we support running multiple daemon instances with different names/ports?
   - **Proposed answer**: Out of scope for initial implementation. Single instance with fixed name. Can be extended later if needed.

3. **Auto-start on install**: Should `daemon install` automatically start the service?
   - **Proposed answer**: Yes, this matches user expectation and the node-* package default behavior.
