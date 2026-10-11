# Design

## Context

See `proposal.md` for motivation and the local ARM64 baseline. The image has an exec-form entrypoint and no application `CMD`. The shared configuration defaults are `server.protocol: auto` and `server.host: 127.0.0.1`; its existing generic environment mapping supports both settings. The Docker E2E suite uses real containers but currently always supplies explicit HTTP startup arguments.

## Goals / Non-Goals

**Goals:** Keep the change in container configuration, preserve explicit overrides and CLI subcommands, and exercise the packaged application rather than inferring startup behavior from image metadata.

**Non-Goals:** Change the application-wide defaults, suppress the ONNX warning, or alter authentication or port-publishing policy.

## Decisions

### Use container environment defaults instead of CMD arguments

Set the lower-precedence alias `DOCS_MCP_PROTOCOL=http` in the runtime stage and retain the existing `HOST=0.0.0.0`, port default, and entrypoint. Do not set generic protocol or host variables in the image: generic variables outrank supported aliases, so image-level generic defaults would suppress runtime `DOCS_MCP_PROTOCOL`, `DOCS_MCP_HOST`, and `HOST` overrides.

An HTTP `CMD` is rejected because Docker replaces it entirely when a caller supplies any application argument; a launch with only `--verbose` would fall back to stdio again. Environment defaults survive unrelated arguments, while runtime `-e` values and explicit CLI options continue to override them.

Do not change the configuration loader or add container-detection logic. Its existing environment-to-config mapping and precedence provide the required behavior.

### Extend the existing real-container suite

Keep the explicit `web` subcommand test and the existing scrape tests. Add default unified-server coverage for no arguments and `--verbose`, checking HTTP readiness and enabled services. Exercise stdio selection through both runtime environment and CLI overrides with the existing MCP client/stdio-transport pattern, connecting to `docker run -i`.

Verify binding overrides through generic variables and both host aliases with the packaged `config get` command; verify protocol selection through both its alias and generic variable. Assert generic overrides still outrank aliases, and retain the existing non-container CLI tests for protocol auto-detection. Do not make warning text, log silence, or CPU-vendor detection a pass/fail condition.

### Make the simplified Docker command the documented default

Remove now-unnecessary HTTP/host/port arguments from the main Docker examples. Explain the HTTP default, how to override the binding, and explicit stdio operation with stdin kept open. Update the Docker client configuration in `docs/guides/mcp-clients.md` to select stdio explicitly. Replace the derived-image HTTP `CMD` example with direct use of the published image.

### Run the Docker suite on both native architectures

Extend the existing Docker job with `amd64` on `ubuntu-latest` and `arm64` on `ubuntu-24.04-arm`. Set each build's platform explicitly and retain `load: true`, so the existing suite uses a locally loaded production image. Use architecture-specific GitHub cache scopes for both cache import and export to prevent the matrix builds from overwriting each other's cache.

Disable matrix fail-fast so a failure on either architecture does not cancel the other diagnostic result. Keep the existing prerequisite jobs and test command. Native runners exercise their real CPU environment; QEMU emulation is unnecessary.

## Program Design

```text
  .github/
    workflows/
~     ci.yml                                 # build and test Docker natively on amd64 and arm64
~ Dockerfile                                  # add runtime protocol and host environment defaults
~ README.md                                   # simplify the Docker quick-start command
~ ARCHITECTURE.md                              # distinguish container defaults from CLI auto-detection
  docs/
    setup/
~     installation.md                         # document defaults, overrides, and explicit stdio
    infrastructure/
~     deployment-modes.md                     # align the single-container example and default description
    guides/
~     mcp-clients.md                          # explicitly select stdio in Docker client configuration
  test/
~   docker-e2e.test.ts                        # cover default startup and override compatibility
```

Use the existing `docker(args, opts)` runner for bounded commands and container lifecycle operations. HTTP cases use Docker-assigned host ports, disable telemetry, wait for real readiness, and stop the specific container in `finally`. Include container logs in readiness failures so native-load errors and ordinary startup failures are distinguishable.

The stdio cases use `Client` and `StdioClientTransport` from the existing MCP client dependency, following `test/mcp-stdio-e2e.test.ts`. Use argument arrays, start only a test-owned container, close the client/transport, and remove the specific container and its anonymous volumes on completion or failure. No new application types, exported functions, or dependencies are required.

The image defaults enter the existing `loadConfig` environment layer before CLI overrides. This ordering is the invariant: changing the default must not hard-code transport or host in the entrypoint.

## Risks / Trade-offs

- Existing Docker stdio consumers change behavior: document `--protocol stdio` or `DOCS_MCP_SERVER_PROTOCOL=stdio`; `auto` restores the previous detection behavior.
- Image environment defaults override conflicting config-file values under the established precedence: document runtime environment or CLI overrides rather than suggesting a config-file-only override.
- Binding all container interfaces changes in-container reachability: keep host-port publishing and authentication configuration unchanged.
- Testing the released `latest` image does not validate a changed Dockerfile: rebuild a separate local image before running regression coverage.

## Migration Plan

Publish the updated image through the existing release workflow. HTTP consumers can remove the redundant startup arguments; explicit subcommands remain valid. Stdio consumers must select their protocol explicitly. Rollback uses the prior image tag or a runtime `auto` protocol override; no data migration is needed.
