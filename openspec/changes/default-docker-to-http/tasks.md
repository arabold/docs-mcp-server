# Tasks

## 1. Container Defaults and Documentation

- [x] 1.1 Set the Docker runtime protocol and host environment defaults to HTTP and all container interfaces; verify the existing entrypoint and configurable port remain unchanged and the rebuilt image reports the intended resolved configuration.
- [x] 1.2 Simplify the README and installation Docker commands and document HTTP defaults, runtime overrides, and explicit stdio with open stdin; verify every shown command agrees with the Dockerfile and configuration precedence.
- [x] 1.3 Update the architecture and deployment-mode descriptions, replacing the unnecessary derived-image HTTP CMD example; verify Docker defaults are distinguished from unchanged non-container auto-detection.

## 2. Regression Coverage

- [x] 2.1 Extend `test/docker-e2e.test.ts` with no-argument and `--verbose` unified-server cases; verify HTTP readiness, Web UI availability, and enabled Web/API/MCP/worker services against the rebuilt image, with diagnostic logs on failure and test-owned container cleanup.
- [x] 2.2 Add real-container stdio cases selected through runtime environment and CLI overrides; verify MCP initialization and tool listing through the existing stdio client pattern and clean up the client, transport, container, and anonymous volumes.
- [x] 2.3 Add packaged-CLI checks for runtime host and port overrides; verify the returned configuration reflects the supplied values rather than the Docker defaults.

## 3. Integration and Delivery

- [x] 3.1 Build the changed image locally on ARM64 and run the complete Docker E2E suite plus the existing CLI default/protocol tests under Node 22; verify no-argument startup is fixed, explicit web/scrape commands still work, and non-container defaults remain unchanged.
- [x] 3.2 Run the repository-required checks, commit without bypassing hooks, push the session branch, and create the requested pull request referencing issue #533; verify the pushed commit and returned PR URL identify this change.

## 4. Review Corrections

- [x] 4.1 Use lower-precedence Docker environment aliases and add protocol/host alias regression cases; verify all Docker tests pass against the rebuilt ARM64 image, including generic-over-alias precedence.
- [x] 4.2 Update the Docker MCP client snippet to select stdio and align the implementation documentation and design; verify the documented invocation matches the tested stdio launch.
- [x] 4.3 Commit and push the verified corrections, reply to the review comments, and resolve the threads; verify the remote PR head and thread resolution state.
