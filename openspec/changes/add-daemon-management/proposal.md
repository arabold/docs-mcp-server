# Change: Add Daemon Management CLI Commands

## Why

Currently, users must manually start the docs-mcp-server by running `./dist/index.js` or `docs-mcp-server` in a terminal window. This requires keeping the terminal open and remembering to restart the server after reboots. A daemon/service installation feature would allow the server to run as a persistent background process that starts automatically on system boot, providing a seamless always-on experience.

## What Changes

- **New CLI command group**: `daemon` with subcommands (`install`, `uninstall`, `status`, `start`, `stop`, `restart`)
- **New dependencies**: `node-mac`, `node-windows`, `node-linux` packages for cross-platform service management
- **New module**: `src/daemon/` containing platform-agnostic daemon service abstraction
- **Configuration storage**: Persist daemon configuration (port, host, etc.) for service startup

### Command Structure

```
docs-mcp-server daemon install [options]   # Install as system service
docs-mcp-server daemon uninstall           # Remove system service
docs-mcp-server daemon status              # Show daemon running status
docs-mcp-server daemon start               # Start the daemon
docs-mcp-server daemon stop                # Stop the daemon
docs-mcp-server daemon restart             # Restart the daemon
```

### Platform Support

| Platform | Mechanism | Service Location |
|----------|-----------|------------------|
| macOS | launchd | `/Library/LaunchDaemons/` (plist) |
| Windows | Windows Service Manager | Windows Services (winsw) |
| Linux | systemd/init.d | `/etc/init.d/` or systemd unit |

### Options for `daemon install`

The install command mirrors key server options to configure the daemon:

- `--port` - Server port (default: from config)
- `--host` - Server host (default: from config)
- `--resume` - Resume interrupted jobs on startup
- `--read-only` - Run in read-only mode
- `--store-path` - Custom data storage directory

## Impact

- **Affected specs**: None (new capability)
- **Affected code**:
  - `src/cli/commands/` - New daemon.ts command
  - `src/cli/index.ts` - Register daemon command
  - `src/daemon/` - New module for service management
  - `package.json` - New dependencies
- **User experience**: Significantly improved for production/daily use
- **Permissions**: Requires elevated privileges (sudo/admin) for install/uninstall
