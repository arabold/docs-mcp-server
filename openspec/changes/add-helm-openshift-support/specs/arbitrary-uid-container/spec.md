# Spec Delta

## Purpose

Ensures the production container runs safely with platform-assigned non-root identities and clearly defined mounted-storage permissions.

## ADDED Requirements

### Requirement: Arbitrary non-root execution
The production container SHALL start and provide its supported application behavior when run with an arbitrary non-zero user ID, without depending on that identity being present in the image's account database.

#### Scenario: Platform-assigned user
- **WHEN** the container runtime starts the image with an arbitrary non-zero user ID and a permitted group that can access its runtime paths
- **THEN** the application starts and serves its configured interface

#### Scenario: Default Docker user
- **WHEN** no runtime user override is supplied
- **THEN** the image starts with a non-root default identity

### Requirement: Writable runtime paths
The container SHALL keep application code non-writable while allowing an arbitrary runtime identity with suitable group permissions to write data, configuration, and temporary runtime files.

#### Scenario: Compatible mounted volumes
- **WHEN** writable volumes grant the runtime identity access to the data and configuration mount roots
- **THEN** the application persists its database and configuration on those volumes

#### Scenario: Incompatible bind mount permissions
- **WHEN** a mounted data or configuration path denies access to the runtime identity and its groups
- **THEN** the application fails clearly instead of silently persisting outside the configured mount

### Requirement: Rootless feature compatibility
Container features that are supported by the production image SHALL not require root privileges at runtime.

#### Scenario: Browser-backed processing
- **WHEN** the image runs with an arbitrary non-root identity and writable runtime storage
- **THEN** browser-backed document scraping can execute without privilege escalation

#### Scenario: Native document processing
- **WHEN** the image runs with an arbitrary non-root identity and processes a supported mounted document
- **THEN** native document extraction completes without root privileges
