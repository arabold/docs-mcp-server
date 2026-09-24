# Design

## Context

See `proposal.md` for motivation. The existing production image uses `USER node` (UID 1000), owns `/data` and `/config` as that user, and is already exercised by `test/docker-e2e.test.ts`. A volume mounted over either path replaces the image directory's ownership. OpenShift commonly supplies an arbitrary UID, and Kubernetes volume ownership behavior depends on admission policy and the storage driver.

The starter chart must mirror the documented single-container Docker invocation, not the three-service Compose topology. The main process must receive explicit HTTP arguments because Kubernetes containers do not have a TTY and automatic protocol detection would otherwise select stdio.

## Goals / Non-Goals

**Goals:**

- Keep one published image usable in ordinary Docker, Kubernetes, and OpenShift.
- Provide conservative security defaults without pinning identity fields controlled by OpenShift.
- Support chart-managed claims, existing claims, and ephemeral storage for both writable paths.
- Make extension possible through `extraResources` without adding templates for every Kubernetes kind.
- Verify both rendered manifests and real operation on a Docker-backed cluster.

**Non-Goals:**

- Deploy the distributed worker/MCP/web topology.
- Add an operator, CRDs, autoscaling, or platform-specific service binding.
- Repair arbitrary host bind-mount ownership from inside the container.
- Require a privileged or root init container.
- Publish the chart to an OCI registry in this initial change.

## Decisions

### Use one chart for one unified workload

The chart will create a Deployment and ClusterIP Service for the existing unified HTTP invocation. This keeps the first chart aligned with the requested starter scope and avoids premature values and lifecycle coupling for the distributed topology. A multi-workload chart was rejected because it would reproduce every Compose component and make persistence, readiness, and upgrade behavior substantially broader.

### Preserve a safe default user but support arbitrary UID overrides

The image uses numeric `USER 65534` (`nobody`) for direct Docker use. Following LiteLLM's OpenShift-compatible pattern, only `/app/.runtime`, `/data`, `/config`, and fallback runtime paths are owned by the default identity, assigned to group 0, and granted matching group permissions. Code under `/app` remains root-owned and non-writable. The chart mounts an `emptyDir` at `/app/.runtime`, allowing a read-only root filesystem while OpenShift assigns an arbitrary UID and permitted supplemental groups. Removing `USER` was rejected because direct Docker execution would regress to root; pinning an image UID in OpenShift manifests was rejected because it conflicts with restricted SCC ranges.

### Delegate mounted-volume ownership to the runtime

The chart leaves `runAsUser`, `runAsGroup`, and `fsGroup` unset by default. Operators may supply pod and container security-context maps, including an allowed `fsGroup` for Kubernetes storage that needs it. OpenShift can therefore assign UID and group ranges through its security policy. A chown init container was rejected because it typically requires root and still cannot fix every storage backend.

### Use TCP probes for the starter chart

The current application has no stable, unauthenticated HTTP liveness endpoint. Startup, readiness, and liveness probes therefore check the configured HTTP socket. Adding new application endpoints is unnecessary for the initial deployment contract and would broaden the change into server API behavior. A Helm test performs an HTTP request through the Service to cover more than socket acceptance.

### Render extra resources with the chart context

`extraResources` is a list of arbitrary manifest objects. The template serializes each object, evaluates embedded Helm expressions with the root release context, and emits a YAML document separator between entries. A raw multiline string was rejected because schema validation and values composition are weaker; kind-specific switches were rejected because they defeat the extension point.

### Model Route independently from Ingress

`route.enabled` controls a `route.openshift.io/v1` Route targeting the Service's named HTTP port. Host, annotations, wildcard policy, and TLS termination settings are configurable. The template is disabled by default so rendering and installation remain valid on clusters without the Route API.

## Program Design

### Affected file tree

```text
~ Dockerfile                                      # permit arbitrary non-root identities on image-owned runtime paths
~ test/docker-e2e.test.ts                         # exercise high UIDs, mounted storage, and rootless runtime features
~ .github/workflows/ci.yml                        # lint and install the chart in a Docker-backed cluster
+ deployment/helm/docs-mcp-server/Chart.yaml     # chart metadata
+ deployment/helm/docs-mcp-server/values.yaml    # supported defaults and extension points
+ deployment/helm/docs-mcp-server/values.schema.json # validate public values
+ deployment/helm/docs-mcp-server/README.md      # chart and OpenShift operator guide
+ deployment/helm/docs-mcp-server/templates/_helpers.tpl
+ deployment/helm/docs-mcp-server/templates/deployment.yaml
+ deployment/helm/docs-mcp-server/templates/service.yaml
+ deployment/helm/docs-mcp-server/templates/serviceaccount.yaml
+ deployment/helm/docs-mcp-server/templates/persistentvolumeclaims.yaml
+ deployment/helm/docs-mcp-server/templates/ingress.yaml
+ deployment/helm/docs-mcp-server/templates/route.yaml
+ deployment/helm/docs-mcp-server/templates/extra-resources.yaml
+ deployment/helm/docs-mcp-server/templates/NOTES.txt
+ deployment/helm/docs-mcp-server/templates/tests/connection-test.yaml
~ docs/setup/installation.md                      # document Helm, OpenShift, and volume permissions
~ README.md                                       # link to the Helm installation path
```

### Values shape

```yaml
image: { repository, tag, digest, pullPolicy }
command: []
args: []
service: { type, port, annotations }
serviceAccount: { create, name, annotations, automountServiceAccountToken }
dataPersistence: { enabled, existingClaim, storageClass, accessModes, size, annotations }
configPersistence: { enabled, existingClaim, storageClass, accessModes, size, annotations }
ingress: { enabled, className, annotations, hosts, tls }
route: { enabled, host, annotations, wildcardPolicy, tls }
podSecurityContext: {}
containerSecurityContext: { runAsNonRoot, allowPrivilegeEscalation, readOnlyRootFilesystem, capabilities }
extraEnv: []
envFrom: []
extraVolumes: []
extraVolumeMounts: []
extraResources: []
```

Identity fields remain absent unless supplied by the operator. The schema accepts Kubernetes resource objects in `extraResources` while validating the chart-owned value shapes.

### Render and runtime flow

```text
helm install/upgrade
    values.schema.json validates public inputs
    templates render
        persistentvolumeclaims.yaml selects created/existing/ephemeral storage
        deployment.yaml mounts /data, /config, /tmp, and /app/.runtime and starts explicit HTTP mode
        service.yaml exposes the named HTTP target port
        ingress.yaml or route.yaml optionally exposes the Service
        extra-resources.yaml evaluates operator objects in release context
    Kubernetes/OpenShift admission assigns allowed identity and groups
    storage driver prepares mounted volumes according to cluster policy
    container starts without root and writes only mounted runtime paths
```

The invariant is that no chart-owned template requires a fixed UID, privileged execution, added capabilities, or a root init container.

## Risks / Trade-offs

- [Some storage drivers ignore or cannot apply supplemental group ownership] -> Keep security contexts configurable and document that operators must provision compatible permissions.
- [Docker host bind mounts replace image directory permissions] -> Test and document explicit host UID/group preparation; do not claim the image can repair inaccessible mounts.
- [A TCP probe can pass before higher-level initialization is complete] -> Use startup/readiness thresholds and a Helm HTTP test; defer a dedicated health endpoint to a separate application change.
- [`extraResources` can create unsafe or release-conflicting objects] -> Treat it as an administrator-controlled escape hatch and document that chart validation cannot guarantee arbitrary resource semantics.
- [Route manifests cannot be installed on vanilla Kubernetes] -> Render the Route only when explicitly enabled and cover disabled defaults in the generic cluster test.
- [A read-only root filesystem may expose an undocumented cache or Chromium write path] -> Exercise Playwright under the chart security context and mount writable `emptyDir` volumes at `/tmp` and `/app/.runtime`.

## Migration Plan

1. Existing Docker users receive the same non-root default identity and paths; no data migration is required.
2. Kubernetes users install a new release and select chart-created or existing claims for `/data` and `/config`.
3. OpenShift users leave identity fields unset and allow SCC admission to assign them; storage classes must support the resulting volume permissions.
4. Rollback consists of reverting the chart release or running the previous image tag while retaining PVCs. Chart-created PVCs are retained on release deletion unless the operator explicitly removes them.
