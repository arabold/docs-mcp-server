# Docs MCP Server Helm chart

This chart deploys one unified Docs MCP Server container. It does not deploy the distributed worker, MCP, and web topology from `docker-compose.yml`.

## Install

Build and publish the image from this branch before installing. The chart uses
`ghcr.io/brtydse100/docs-mcp-server-nonroot:3.2.0`; the upstream image does not contain
these branch changes. Authenticate to your registry, then run from the repository root:

```bash
docker build -t ghcr.io/brtydse100/docs-mcp-server-nonroot:3.2.0 .
docker push ghcr.io/brtydse100/docs-mcp-server-nonroot:3.2.0
```

Set `image.repository` and `image.tag` for another registry or tag, or set
`image.digest` to pin an immutable build. Private registries require
`imagePullSecrets`; both the Deployment and the Helm test Pod use these secrets.

```bash
helm upgrade --install docs-mcp ./deployment/helm/docs-mcp-server \
  --namespace docs-mcp --create-namespace
```

The default release creates persistent claims for `/data` and `/config` and exposes port 6280 through a ClusterIP Service. Run the smoke test after the workload becomes ready:

```bash
helm test docs-mcp --namespace docs-mcp
```

## Storage

Use existing claims when storage is provisioned separately:

```yaml
dataPersistence:
  existingClaim: docs-mcp-data
configPersistence:
  existingClaim: docs-mcp-config
```

Set either persistence block's `enabled` value to `false` to use an ephemeral `emptyDir`. Mounted volumes replace the permissions built into the image. On ordinary Kubernetes the chart defaults to `runAsUser: 65534`, `runAsGroup: 65534`, and `fsGroup: 65534` so the nobody user can write supported volumes. Override `podSecurityContext.fsGroup` if the storage driver or cluster policy requires another group. Storage drivers that do not support ownership management need pre-provisioned permissions.

The unified server runs one embedded worker against a SQLite store. The chart
requires `replicaCount: 1` and uses `Recreate` upgrades so two workers do not
overlap and ReadWriteOnce volumes can detach before the replacement starts.
Upgrades briefly interrupt service.

## OpenShift

Set `openshift.enabled: true` when installing on OpenShift. This omits the
Kubernetes defaults for `runAsUser`, `runAsGroup`, and `fsGroup`, allowing the SCC
to assign values from the namespace's permitted ranges.
Explicit `podSecurityContext` fields are still honored, so omit fixed IDs from
OpenShift values unless your SCC permits them.

The image uses `USER 65534` (`nobody`, primary group 65534), following LiteLLM's
OpenShift-compatible ownership approach. Writable paths are owned by nobody and
group 0 receives matching permissions for arbitrary UIDs. Directories use the
setgid bit so new files inherit group 0; the entrypoint's `umask 0002` preserves
group write access. Application code remains root-owned and read-only. The
working directory is `/app` and the home directory is `/app/.runtime`.

| Path | Purpose |
| --- | --- |
| `/app/.runtime` | Home-relative runtime state |
| `/app/.runtime/cache` | XDG and dependency caches |
| `/app/.runtime/cache/npm` | npm cache |
| `/data` | SQLite database and application data |
| `/config` | Application and Chromium configuration |
| `/nonexistent` | Home fallback from the nobody passwd entry |
| `/tmp` | Temporary files and browser profiles |

The chart uses `readOnlyRootFilesystem: true`, requires a non-root process,
drops all capabilities, and disables privilege escalation. It mounts writable
volumes at `/data`, `/config`, `/tmp`, and `/app/.runtime`, keeping application
code immutable while allowing runtime caches under restricted SCCs.

OpenShift may replace UID 65534 with a namespace-assigned UID. To require exactly
65534 on OpenShift, your SCC must permit that UID before setting
`podSecurityContext.runAsUser: 65534`.

Enable an OpenShift Route with:

```yaml
openshift:
  enabled: true
route:
  enabled: true
  host: docs-mcp.apps.example.com
  tls:
    enabled: true
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

Only edge TLS termination is supported: the server's backend port speaks HTTP.
Passthrough and re-encrypt routes require a TLS-enabled backend.

## Extra resources

`extraResources` accepts additional Kubernetes objects and evaluates Helm expressions in the release context:

```yaml
extraResources:
  - apiVersion: v1
    kind: ConfigMap
    metadata:
      name: '{{ include "docs-mcp-server.fullname" . }}-extra'
    data:
      example: value
```

This is an administrator-controlled escape hatch. The chart cannot validate the semantics or security of arbitrary resources.

## Local documents

Mount a document source with `extraVolumes` and `extraVolumeMounts`, then add that in-container path to `DOCS_MCP_SCRAPER_SECURITY_FILE_ACCESS_ALLOWED_ROOTS`. The default `$DOCUMENTS` token refers to the runtime user's `Documents` directory and usually does not resolve in a container.
