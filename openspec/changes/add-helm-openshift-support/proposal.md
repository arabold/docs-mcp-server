# Proposal

## Why

Operators need a supported way to deploy Docs MCP Server to Kubernetes and OpenShift without assembling manifests themselves. The existing container defaults to a fixed non-root account and does not prove that the application or its mounted data and configuration paths work with the arbitrary user IDs assigned by restricted platforms.

## What Changes

- Add a starter Helm chart under `deployment/helm/docs-mcp-server` that deploys one unified Docs MCP Server image, a Service, persistent data and configuration storage, and optional Ingress resources.
- Add an optional OpenShift `Route` and an `extraResources` value for operator-supplied Kubernetes objects without expanding the starter chart into the distributed topology.
- Harden the production image so its image-owned runtime paths support arbitrary non-root UIDs while application code remains non-writable.
- Make pod identity, supplemental-group, and volume ownership settings configurable without fixing an OpenShift runtime UID.
- Extend container and chart verification to cover arbitrary UIDs, writable mounted storage, rendering variants, and installation on a local Docker-backed Kubernetes cluster.
- Document Helm installation, OpenShift behavior, and the permissions operators must provide for host bind mounts or storage drivers that do not prepare volume ownership.

## Capabilities

### New Capabilities

- `helm-deployment`: Installation of the unified Docs MCP Server image through a configurable Helm chart, including storage, networking, extra resources, and an optional OpenShift Route.
- `arbitrary-uid-container`: Execution of the production container as a platform-assigned non-root UID with explicit writable-storage requirements and no dependency on UID 1000.

### Modified Capabilities

None.

## Impact

- Affects the production `Dockerfile`, Docker E2E coverage, CI workflows, and container deployment documentation.
- Adds the chart under `deployment/helm/docs-mcp-server` and local/CI chart validation.
- Retains the existing image, command-line interface, ports, `/data` store path, and `/config` configuration path.
- Adds Helm as deployment tooling and a local Docker-backed Kubernetes cluster tool for full chart verification; neither becomes an application runtime dependency.
