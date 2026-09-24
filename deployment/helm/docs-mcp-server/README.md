# Docs MCP Server Helm chart

This chart deploys one unified Docs MCP Server container. It does not deploy the distributed worker, MCP, and web topology from `docker-compose.yml`.

## Install

Build and publish the image from this branch before installing. The chart uses
`ghcr.io/brtydse100/docs-mcp-server:nonroot`; the upstream image does not contain
these branch changes. Authenticate to your registry, then run from the repository root:

```bash
docker build -t ghcr.io/brtydse100/docs-mcp-server:nonroot .
docker push ghcr.io/brtydse100/docs-mcp-server:nonroot
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

Set either persistence block's `enabled` value to `false` to use an ephemeral `emptyDir`. Mounted volumes replace the permissions built into the image. On ordinary Kubernetes the chart defaults to `fsGroup: 1000` to make supported volumes writable. Override `podSecurityContext.fsGroup` if the storage driver or cluster policy requires another group. Storage drivers that do not support ownership management need pre-provisioned permissions.

The unified server runs one embedded worker against a SQLite store. The chart
requires `replicaCount: 1` and uses `Recreate` upgrades so two workers do not
overlap and ReadWriteOnce volumes can detach before the replacement starts.
Upgrades briefly interrupt service.

## OpenShift

Set `openshift.enabled: true` when installing on OpenShift. This omits the
Kubernetes default `fsGroup`, allowing the SCC to assign values from the namespace's
permitted ranges. The chart leaves `runAsUser` and `runAsGroup` unset in both modes.
Explicit `podSecurityContext` fields are still honored, so omit fixed IDs from
OpenShift values unless your SCC permits them.

The image defaults to UID 1000 and GID 0, uses `/data` as its working directory,
and keeps application code in `/app`. Home and cache writes go to `/tmp`;
configuration goes to `/config`. The chart mounts all three writable paths and
uses a read-only root filesystem.

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
