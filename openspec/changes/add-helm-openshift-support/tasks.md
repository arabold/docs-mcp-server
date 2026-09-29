# Tasks

## 1. Arbitrary-UID container

- [x] 1.1 Change image-owned runtime directories to support arbitrary non-root UIDs through group permissions while retaining the default non-root Docker user, and verify image code remains non-writable with Docker inspection commands.
- [x] 1.2 Extend `test/docker-e2e.test.ts` with arbitrary high-UID coverage for HTTP startup, SQLite/config writes on compatible mounts, Playwright, native document processing, and clear failure on inaccessible mounts; verify `npm run test:docker` passes against the built image.

## 2. Starter Helm chart

- [x] 2.1 Create chart metadata, helpers, defaults, and values schema under `deployment/helm/docs-mcp-server`, and verify `helm lint` and default `helm template` succeed.
- [x] 2.2 Add the single unified Deployment, Service, ServiceAccount, probes, and configurable security contexts without fixed UID/GID defaults; verify rendered manifests start explicit HTTP mode and require no root privileges or added capabilities.
- [x] 2.3 Add independent data/config claim creation, existing-claim selection, and ephemeral volume support; verify a render matrix mounts `/data` and `/config` from the selected volume types.
- [x] 2.4 Add optional Ingress and OpenShift Route templates, and verify disabled, enabled, TLS, host, annotation, and Service-port render cases.
- [x] 2.5 Add `extraResources` rendering with release-context template evaluation, and verify empty, static-resource, and templated-resource cases through rendered output.
- [x] 2.6 Add a Helm connection test and operator-facing chart README, and verify the packaged chart contains both artifacts.

## 3. Local and CI integration verification

- [x] 3.1 Install pinned local Helm and Docker-backed cluster tooling without adding runtime dependencies, then validate all chart value combinations against Kubernetes schemas.
- [x] 3.2 Build the production image, load it into a disposable local cluster, install the default chart, wait for rollout, and verify `helm test`, HTTP access, non-root identity, and writes to both runtime volumes.
- [x] 3.3 Verify Pod replacement and Helm upgrade preserve data/config on PVCs, then verify an arbitrary high UID with an allowed supplemental group can run the same release.
- [x] 3.4 Extend CI to lint/render the chart and install it in a disposable cluster using the prebuilt E2E image; verify failure diagnostics include workload descriptions and logs.

## 4. Documentation and repository checks

- [x] 4.1 Update installation and top-level documentation for Helm, optional Route, `extraResources`, OpenShift arbitrary UID behavior, PVC ownership, and host bind-mount preparation; verify all documented commands and paths match the chart.
- [ ] 4.2 Run Node.js 22 formatting, lint, typecheck, build, standard tests, Docker E2E tests, Helm lint/render checks, and local cluster tests; verify the worktree contains only scoped changes and every check passes.
