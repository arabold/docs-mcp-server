# Docs MCP Server Helm chart

This chart deploys one unified Docs MCP Server container. It does not deploy the distributed worker, MCP, and web topology from `docker-compose.yml`.

## Install

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

Set either persistence block's `enabled` value to `false` to use an ephemeral `emptyDir`. Mounted volumes replace the permissions built into the image. The storage driver, OpenShift SCC, or a permitted `podSecurityContext.fsGroup` must make each volume writable by the assigned identity.

## OpenShift

The chart does not set `runAsUser`, `runAsGroup`, or `fsGroup` by default. OpenShift can assign values from the namespace's permitted ranges. The container requires a non-root identity with write access to `/data`, `/config`, and `/tmp`; it does not require privilege escalation or Linux capabilities.

Enable an OpenShift Route with:

```yaml
route:
  enabled: true
  host: docs-mcp.apps.example.com
  tls:
    enabled: true
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
```

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
