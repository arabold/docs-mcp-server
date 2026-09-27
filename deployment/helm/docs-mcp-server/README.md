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

Set either persistence block's `enabled` value to `false` to use an ephemeral `emptyDir`. Mounted volumes replace the permissions built into the image. On ordinary Kubernetes the chart defaults to `runAsUser: 10001`, `runAsGroup: 10001`, and `fsGroup: 10001` so the dedicated runtime user can write supported volumes. Override `podSecurityContext.fsGroup` if the storage driver or cluster policy requires another group. Storage drivers that do not support ownership management need pre-provisioned permissions.

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

The image uses a dedicated `USER 10001:10001` runtime account, following Litegate's
OpenShift-compatible ownership approach. Only the runtime paths are writable by
arbitrary non-root UID/GID combinations. The entrypoint's `umask 0000` keeps
runtime data writable if the platform changes both IDs. Application code remains
root-owned and read-only. The
working directory is `/app` and the home directory is `/app/.runtime`.

| Path | Purpose |
| --- | --- |
| `/app/.runtime` | Home-relative runtime state |
| `/app/.runtime/cache` | XDG and dependency caches |
| `/app/.runtime/cache/npm` | npm cache |
| `/data` | SQLite database and application data |
| `/config` | Application and Chromium configuration |
| `/nonexistent` | Compatibility fallback for libraries without a writable home |
| `/tmp` | Temporary files and browser profiles |

The chart uses `readOnlyRootFilesystem: true`, requires a non-root process,
drops all capabilities, and disables privilege escalation. It mounts writable
volumes at `/data`, `/config`, `/tmp`, and `/app/.runtime`, keeping application
code immutable while allowing runtime caches under restricted SCCs.

OpenShift may replace UID 10001 with a namespace-assigned UID. To require exactly
10001 on OpenShift, your SCC must permit that UID before setting
`podSecurityContext.runAsUser: 10001`.

### Validate an OpenShift-style identity with Podman

The image was validated with UID and GID `1000640000`, with no membership in
UID 0, GID 0, or group 0. Rootless Podman normally cannot map IDs outside the
host user's subordinate-ID range, so the following Windows commands use the
Podman machine's rootful engine for the test harness. The application process
inside the container still runs exclusively as `1000640000:1000640000`.

Authenticate the rootful Podman store and pull the published image:

```powershell
gh auth token | podman machine ssh "sudo podman login ghcr.io --username brtydse100 --password-stdin"
podman machine ssh "sudo podman pull ghcr.io/brtydse100/docs-mcp-server-nonroot:3.2.0"
```

Create a Podman pod and start the same explicit HTTP mode used by this chart:

```powershell
podman machine ssh "sudo podman pod create --name docs-mcp-highuid -p 16281:6280"
podman machine ssh "sudo podman run -d --name docs-mcp-highuid --pod docs-mcp-highuid --user 1000640000:1000640000 ghcr.io/brtydse100/docs-mcp-server-nonroot:3.2.0 --protocol http --host 0.0.0.0 --port 6280"
```

Verify the exact identity, writable runtime paths, immutable application code,
and HTTP response:

```powershell
podman machine ssh "sudo podman exec docs-mcp-highuid id"
podman machine ssh "sudo podman exec docs-mcp-highuid sh -c 'touch /data/highuid-test /config/highuid-test /app/.runtime/highuid-test && test ! -w /app/dist && echo permissions-ok'"
podman machine ssh "curl -sS -o /dev/null -w 'http=%{http_code}\n' http://127.0.0.1:16281/"
```

Expected output includes:

```text
uid=1000640000 gid=1000640000 groups=1000640000
permissions-ok
http=200
```

Remove the disposable pod after testing:

```powershell
podman machine ssh "sudo podman pod rm -f docs-mcp-highuid"
```

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
