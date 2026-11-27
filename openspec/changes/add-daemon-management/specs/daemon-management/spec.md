# Daemon Management Specification

## ADDED Requirements

### Requirement: Daemon Installation

The system SHALL provide a CLI command to install the docs-mcp-server as a native system daemon/service.

The installation:
- MUST register the server with the operating system's service manager (launchd on macOS, Windows Service Manager on Windows, systemd/init.d on Linux)
- MUST accept optional configuration options (port, host, store-path, resume, read-only)
- MUST persist configuration as environment variables in the service definition
- MUST start the service automatically after successful installation
- MUST require elevated privileges (sudo/admin) and provide a clear error message if not available

#### Scenario: Successful daemon installation on macOS
- **GIVEN** the user has administrative privileges
- **WHEN** the user runs `docs-mcp-server daemon install --port 3000`
- **THEN** a launchd plist is created in `/Library/LaunchDaemons/`
- **AND** the service is started automatically
- **AND** a success message is displayed with service status

#### Scenario: Successful daemon installation on Windows
- **GIVEN** the user has administrative privileges
- **WHEN** the user runs `docs-mcp-server daemon install --port 3000`
- **THEN** a Windows Service is registered
- **AND** the service is started automatically
- **AND** a success message is displayed with service status

#### Scenario: Successful daemon installation on Linux
- **GIVEN** the user has root privileges
- **WHEN** the user runs `docs-mcp-server daemon install --port 3000`
- **THEN** a systemd unit or init.d script is created
- **AND** the service is started automatically
- **AND** a success message is displayed with service status

#### Scenario: Installation without elevated privileges
- **GIVEN** the user does not have elevated privileges
- **WHEN** the user runs `docs-mcp-server daemon install`
- **THEN** an error message is displayed explaining that sudo/admin privileges are required
- **AND** the command exits with a non-zero status code

#### Scenario: Installation when already installed
- **GIVEN** the daemon is already installed
- **WHEN** the user runs `docs-mcp-server daemon install`
- **THEN** an informative message is displayed indicating the service is already installed
- **AND** the user is prompted to uninstall first or use restart

---

### Requirement: Daemon Uninstallation

The system SHALL provide a CLI command to uninstall the docs-mcp-server daemon/service.

The uninstallation:
- MUST stop the service if running
- MUST remove the service registration from the operating system
- MUST remove service-related files (plist, wrapper executables, etc.)
- MUST NOT delete user data (database, configuration files, logs)
- MUST require elevated privileges

#### Scenario: Successful daemon uninstallation
- **GIVEN** the daemon is installed and running
- **WHEN** the user runs `docs-mcp-server daemon uninstall` with elevated privileges
- **THEN** the service is stopped
- **AND** the service registration is removed
- **AND** a success message is displayed

#### Scenario: Uninstallation when not installed
- **GIVEN** the daemon is not installed
- **WHEN** the user runs `docs-mcp-server daemon uninstall`
- **THEN** an informative message is displayed indicating no service is installed

---

### Requirement: Daemon Status

The system SHALL provide a CLI command to check the status of the installed daemon.

#### Scenario: Status of running daemon
- **GIVEN** the daemon is installed and running
- **WHEN** the user runs `docs-mcp-server daemon status`
- **THEN** the output shows:
  - Service name
  - Status: "running"
  - Process ID (PID)
  - Configured port and host

#### Scenario: Status of stopped daemon
- **GIVEN** the daemon is installed but not running
- **WHEN** the user runs `docs-mcp-server daemon status`
- **THEN** the output shows:
  - Service name
  - Status: "stopped"

#### Scenario: Status when not installed
- **GIVEN** the daemon is not installed
- **WHEN** the user runs `docs-mcp-server daemon status`
- **THEN** the output indicates the service is not installed

---

### Requirement: Daemon Start

The system SHALL provide a CLI command to start an installed daemon.

#### Scenario: Start stopped daemon
- **GIVEN** the daemon is installed but not running
- **WHEN** the user runs `docs-mcp-server daemon start` with elevated privileges
- **THEN** the service is started
- **AND** a success message is displayed

#### Scenario: Start already running daemon
- **GIVEN** the daemon is installed and running
- **WHEN** the user runs `docs-mcp-server daemon start`
- **THEN** an informative message is displayed indicating the service is already running

#### Scenario: Start when not installed
- **GIVEN** the daemon is not installed
- **WHEN** the user runs `docs-mcp-server daemon start`
- **THEN** an error message is displayed indicating the service must be installed first

---

### Requirement: Daemon Stop

The system SHALL provide a CLI command to stop a running daemon.

#### Scenario: Stop running daemon
- **GIVEN** the daemon is installed and running
- **WHEN** the user runs `docs-mcp-server daemon stop` with elevated privileges
- **THEN** the service is stopped
- **AND** a success message is displayed

#### Scenario: Stop already stopped daemon
- **GIVEN** the daemon is installed but not running
- **WHEN** the user runs `docs-mcp-server daemon stop`
- **THEN** an informative message is displayed indicating the service is already stopped

---

### Requirement: Daemon Restart

The system SHALL provide a CLI command to restart a running daemon.

#### Scenario: Restart running daemon
- **GIVEN** the daemon is installed and running
- **WHEN** the user runs `docs-mcp-server daemon restart` with elevated privileges
- **THEN** the service is stopped and started
- **AND** a success message is displayed

#### Scenario: Restart stopped daemon
- **GIVEN** the daemon is installed but not running
- **WHEN** the user runs `docs-mcp-server daemon restart` with elevated privileges
- **THEN** the service is started
- **AND** a success message is displayed

---

### Requirement: Cross-Platform Support

The daemon management system SHALL support macOS, Windows, and Linux operating systems.

- On macOS, the system MUST use launchd for service management
- On Windows, the system MUST use Windows Service Manager (via winsw)
- On Linux, the system MUST use systemd or init.d scripts

#### Scenario: Platform detection on macOS
- **GIVEN** the system is running on macOS
- **WHEN** any daemon command is executed
- **THEN** the system uses launchd-based service management

#### Scenario: Platform detection on Windows
- **GIVEN** the system is running on Windows
- **WHEN** any daemon command is executed
- **THEN** the system uses Windows Service Manager

#### Scenario: Platform detection on Linux
- **GIVEN** the system is running on Linux
- **WHEN** any daemon command is executed
- **THEN** the system uses systemd or init.d based service management

---

### Requirement: Automatic Restart on Crash

The daemon service SHALL automatically restart if the server process crashes unexpectedly.

The restart behavior:
- MUST use exponential backoff (default: 1 second initial, 25% growth)
- MUST cap restart attempts to prevent infinite loops (default: 5 restarts per 60 seconds)
- MUST log restart attempts

#### Scenario: Automatic restart after crash
- **GIVEN** the daemon is running
- **WHEN** the server process crashes unexpectedly
- **THEN** the service manager restarts the process after a brief delay
- **AND** the restart is logged

#### Scenario: Restart cap prevents infinite loop
- **GIVEN** the daemon is running
- **AND** the server crashes repeatedly due to a fatal error
- **WHEN** the restart limit is reached (5 restarts in 60 seconds)
- **THEN** the service stops attempting restarts
- **AND** the failure is logged
