# Proposal

## Why

A Docker launch without arguments selects stdio and exits cleanly when stdin closes, leaving only an unrelated ONNX CPU-vendor warning visible. Local testing of the published ARM64 image reproduces this behavior from issue #533 while confirming that HTTP startup, MCP initialization, and all six existing Docker E2E tests succeed with explicit HTTP arguments.

## What Changes

- Default the Docker image to HTTP on all container interfaces, using the existing configurable server port.
- Retain the Docker defaults when users supply unrelated options such as `--verbose`, while allowing runtime environment variables and CLI flags to override them.
- **BREAKING**: Docker users relying on automatic stdio selection must explicitly select stdio or restore protocol auto-detection. Non-container CLI defaults remain unchanged.
- Align the README and deployment documentation with the Docker defaults and describe explicit stdio operation.
- Extend the existing Docker E2E suite to cover no-argument startup and configuration overrides.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `configuration`: Define Docker-specific server defaults, their override behavior, and preservation of non-container defaults.

## Impact

- `Dockerfile`: Container environment defaults; existing entrypoint and subcommands remain intact.
- `test/docker-e2e.test.ts`: Real-container startup and override regression coverage.
- `README.md`, `ARCHITECTURE.md`, `docs/setup/installation.md`, and `docs/infrastructure/deployment-modes.md`: Docker usage and protocol-default documentation.
- No application configuration-loader changes, dependency changes, or image-platform changes.
